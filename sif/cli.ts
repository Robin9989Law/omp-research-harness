import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { runBackend } from "./backends";
import { certify } from "./certify";
import { compileHtir, emptyHtir } from "./htir";
import { ingestLiveRun } from "./ingest";
import { regressionAwareAccept, heldOutRegressed } from "./accept";
import { classifyFiles, loadImpactSurfaces } from "./impact";
import { appendLedger, artifactHash, findReusablePass, loadLedger, reuseKey } from "./ledger";
import { attachFlawId, consolidateFlaws, evolutionFromRepair } from "./flaws";
import { lockBump } from "./lock-bump";
import { buildPlan, impactSignature } from "./plan";
import { attributeFailure } from "./repair";
import { elicitationRegression, outcomeClassFor, scoreHtir } from "./scorecard";
import {
	PROJECT_ROOT,
	RUNS_DIR,
	STATE_FILE,
	cannotRerun,
	filesShaFromLock,
	loadState,
	markExecuted,
	saveState,
	sha256,
} from "./state";
import type { FailureClass, IterationState, PlanStep, RepairSpec } from "./types";
import { SCHEMA_VERSION, SCORECARD_SCHEMA } from "./types";
import { workspaceSnapshot } from "./workspace";

function option(name: string, argv = process.argv): string | undefined {
	const index = argv.indexOf(name);
	return index >= 0 ? argv[index + 1] : undefined;
}

function flag(name: string, argv = process.argv): boolean {
	return argv.includes(name);
}

function failLedgerMeta(options: {
	failureClass: FailureClass;
	repairSpec: RepairSpec;
	artifacts: Record<string, { path: string; sha256: string }>;
	step: PlanStep;
	deleteScaffold?: boolean;
}) {
	const evolutionCandidate = evolutionFromRepair(options.repairSpec, { deleteScaffold: options.deleteScaffold });
	const ledgerStep = { layer: options.step.layer, node: options.step.nodes?.[0] ?? null, backend: options.step.backend };
	return {
		evolutionCandidate,
		flawId: attachFlawId({
			failureClass: options.failureClass,
			evolutionCandidate,
			artifacts: options.artifacts,
			step: ledgerStep,
			repairSpec: options.repairSpec,
		}),
	};
}

async function syncState(options?: { passK?: number; base?: string }): Promise<IterationState> {
	const workspace = workspaceSnapshot(PROJECT_ROOT, { base: options?.base });
	const files = workspace.files;
	const surfaces = await loadImpactSurfaces();
	const impact = classifyFiles(files, surfaces);
	const signature = sha256(impactSignature(impact, files));
	const iphLock = await filesShaFromLock();
	const existing = await loadState();
	if (existing && existing.iphLock.commit === iphLock.commit) {
		const inFlight = existing.next_required_action === "REPAIR"
			|| existing.next_required_action === "REPLAY"
			|| (existing.executedKeys.length > 0 && existing.next_required_action !== "DONE");
		if (existing.delta.signature === signature || inFlight) {
			existing.harnessHead = workspace.head;
			existing.workingTreeDirty = workspace.dirty;
			await saveState(existing);
			return existing;
		}
	}
	const planned = buildPlan(impact, { passK: options?.passK ?? 2 });
	const state: IterationState = {
		schemaVersion: SCHEMA_VERSION,
		scorecardSchema: SCORECARD_SCHEMA,
		harnessHead: workspace.head,
		workingTreeDirty: workspace.dirty,
		iphLock,
		delta: {
			files,
			classes: impact.classes,
			signature,
			unknownFiles: impact.unknownFiles,
		},
		planId: randomUUID(),
		plan: { steps: planned.steps },
		currentStepIndex: 0,
		next_required_action: planned.steps.length > 0 ? "RUN_STEP" : "CERTIFY",
		outcomeClass: null,
		stop: null,
		scorecard: null,
		runId: randomUUID(),
		executedKeys: [],
		passK: options?.passK ?? 2,
		deferred: planned.deferred,
	};
	await saveState(state);
	return state;
}

async function writeRunArtifact(runId: string, name: string, contents: string): Promise<{ path: string; sha256: string }> {
	const directory = path.join(RUNS_DIR, runId);
	await mkdir(directory, { recursive: true });
	const file = path.join(directory, name);
	await writeFile(file, contents);
	return { path: path.relative(PROJECT_ROOT, file), sha256: artifactHash(contents) };
}

async function runStep(state: IterationState, step: PlanStep, mode: "RUN" | "REPLAY", argv: string[]): Promise<IterationState> {
	if (mode === "RUN" && cannotRerun(state, step.id, "RUN")) {
		throw new Error(`refusing to rerun ${step.id} with the same planId/failure code; use a new plan or replay after repair`);
	}
	const result = await runBackend(step, {
		realModels: flag("--real-models", argv),
		ablation: flag("--ablation", argv),
	});
	const traceRoot = process.env.SIF_TRACE_ROOT?.trim();
	const htir = traceRoot ? await compileHtir({ traceRoot }) : emptyHtir();
	const scorecard = scoreHtir(htir);
	const runId = state.runId ?? randomUUID();
	const htirArtifact = await writeRunArtifact(runId, `${step.id}.htir.json`, `${JSON.stringify(htir, null, 2)}\n`);
	const logArtifact = await writeRunArtifact(runId, `${step.id}.log`, result.output);
	const key = reuseKey({
		iphLock: state.iphLock,
		layer: step.layer,
		node: step.nodes?.[0],
		harnessContractHash: state.delta.signature,
	});

	if (!result.ok) {
		const failureClass = result.output.includes("deadlock") || result.output.includes("EFFICIENCY")
			? "EFFICIENCY_REGRESSION"
			: "CONTRACT_FAIL";
		const repairSpec = attributeFailure({
			failureClass,
			message: result.output.slice(-2000),
			steps: htir.steps,
		});
		markExecuted(state, step.id, failureClass);
		state.next_required_action = "REPAIR";
		state.outcomeClass = "failed";
		state.scorecard = scorecard;
		state.stop = {
			failureClass,
			stepId: step.id,
			message: `backend ${step.backend} exited ${result.exitCode}`,
			htirPath: htirArtifact.path,
			repairSpec,
		};
		await appendLedger({
			kind: mode === "REPLAY" ? "REPLAY" : "FAIL",
			harnessHead: state.harnessHead,
			iphLock: state.iphLock,
			reuseKey: key,
			step: { layer: step.layer, node: step.nodes?.[0] ?? null, backend: step.backend },
			failureClass,
			artifacts: { htir: htirArtifact, log: logArtifact },
			scorecard,
			...failLedgerMeta({
				failureClass,
				repairSpec,
				artifacts: { htir: htirArtifact, log: logArtifact },
				step,
			}),
		});
		await saveState(state);
		return state;
	}

	const deferred = result.output.includes("sif_backend=DEFERRED");
	const processIssue = !deferred && step.oracle !== "outcome" && htir.steps.length > 0
		? elicitationRegression(scorecard)
		: undefined;
	if (processIssue) {
		const repairSpec = attributeFailure({
			failureClass: "ELICITATION_REGRESSION",
			message: processIssue,
			steps: htir.steps,
		});
		markExecuted(state, step.id, "ELICITATION_REGRESSION");
		state.next_required_action = "REPAIR";
		state.outcomeClass = outcomeClassFor({ outcomeReady: true, scorecard });
		state.scorecard = scorecard;
		state.stop = {
			failureClass: "ELICITATION_REGRESSION",
			stepId: step.id,
			message: processIssue,
			htirPath: htirArtifact.path,
			repairSpec,
		};
		await appendLedger({
			kind: "FAIL",
			harnessHead: state.harnessHead,
			iphLock: state.iphLock,
			reuseKey: key,
			step: { layer: step.layer, node: step.nodes?.[0] ?? null, backend: step.backend },
			failureClass: "ELICITATION_REGRESSION",
			artifacts: { htir: htirArtifact, log: logArtifact },
			scorecard,
			...failLedgerMeta({
				failureClass: "ELICITATION_REGRESSION",
				repairSpec,
				artifacts: { htir: htirArtifact, log: logArtifact },
				step,
				deleteScaffold: true,
			}),
		});
		await saveState(state);
		return state;
	}

	markExecuted(state, step.id, "RUN");
	if (mode === "REPLAY") {
		const decision = regressionAwareAccept({
			before: state.scorecard,
			after: scorecard,
			targetGone: true,
			heldOutStillPass: !heldOutRegressed(await loadLedger(), key),
		});
		if (!decision.accept) {
			const repairSpec = attributeFailure({
				failureClass: "CONTRACT_FAIL",
				message: decision.reasons.join("; "),
				steps: htir.steps,
			});
			state.next_required_action = "REPAIR";
			state.outcomeClass = "failed";
			state.scorecard = scorecard;
			state.stop = {
				failureClass: "CONTRACT_FAIL",
				stepId: step.id,
				message: `regression-aware accept rejected: ${decision.reasons.join("; ")}`,
				htirPath: htirArtifact.path,
				repairSpec,
			};
			await appendLedger({
				kind: "REJECTED_EVOLUTION",
				harnessHead: state.harnessHead,
				iphLock: state.iphLock,
				reuseKey: key,
				step: { layer: step.layer, node: step.nodes?.[0] ?? null, backend: step.backend },
				failureClass: "CONTRACT_FAIL",
				artifacts: { htir: htirArtifact, log: logArtifact },
				scorecard,
				...failLedgerMeta({
					failureClass: "CONTRACT_FAIL",
					repairSpec,
					artifacts: { htir: htirArtifact, log: logArtifact },
					step,
				}),
			});
			await saveState(state);
			return state;
		}
	}
	await appendLedger({
		kind: "PASS",
		harnessHead: state.harnessHead,
		iphLock: state.iphLock,
		reuseKey: key,
		step: { layer: step.layer, node: step.nodes?.[0] ?? null, backend: step.backend },
		artifacts: { htir: htirArtifact, log: logArtifact },
		scorecard,
		isolatedTrials: result.isolatedTrials ?? null,
	});
	state.scorecard = scorecard;
	state.stop = null;
	state.currentStepIndex += 1;
	if (state.currentStepIndex >= state.plan.steps.length) {
		state.next_required_action = "CERTIFY";
		state.outcomeClass = outcomeClassFor({ outcomeReady: true, scorecard, htir });
	} else {
		state.next_required_action = "RUN_STEP";
	}
	await saveState(state);
	return state;
}

async function iterate(argv: string[]): Promise<void> {
	const dryRun = flag("--dry-run", argv);
	const state = await syncState({
		passK: Number(option("--pass-k", argv) ?? "2"),
		base: option("--base", argv),
	});
	if (dryRun) {
		process.stdout.write(`${JSON.stringify({
			sif: "DRY_RUN_READY",
			next_required_action: state.next_required_action,
			planId: state.planId,
			steps: state.plan.steps.map(step => step.id),
			unknownFiles: state.delta.unknownFiles ?? [],
		}, null, 2)}\n`);
		return;
	}
	if (state.next_required_action === "REPAIR") {
		process.stdout.write(`${JSON.stringify({ sif: "STOP", next_required_action: "REPAIR", stop: state.stop }, null, 2)}\n`);
		process.exitCode = 2;
		return;
	}
	if (state.next_required_action === "CERTIFY" || state.next_required_action === "DONE") {
		process.stdout.write(`${JSON.stringify({ sif: "READY", next_required_action: state.next_required_action }, null, 2)}\n`);
		return;
	}
	const step = state.plan.steps[state.currentStepIndex];
	if (!step) {
		state.next_required_action = "CERTIFY";
		await saveState(state);
		return;
	}
	const key = reuseKey({
		iphLock: state.iphLock,
		layer: step.layer,
		node: step.nodes?.[0],
		harnessContractHash: state.delta.signature,
	});
	const reusable = findReusablePass(await loadLedger(), key);
	if (reusable && !step.realModels) {
		state.currentStepIndex += 1;
		state.next_required_action = state.currentStepIndex >= state.plan.steps.length ? "CERTIFY" : "RUN_STEP";
		await saveState(state);
		process.stdout.write(`${JSON.stringify({ sif: "REUSED", step: step.id, reuseKey: key }, null, 2)}\n`);
		return;
	}
	const after = await runStep(state, step, "RUN", argv);
	process.stdout.write(`${JSON.stringify({
		sif: after.next_required_action === "REPAIR" ? "STOP" : "READY",
		next_required_action: after.next_required_action,
		step: step.id,
		outcomeClass: after.outcomeClass,
		stop: after.stop,
	}, null, 2)}\n`);
	if (after.next_required_action === "REPAIR") process.exitCode = 2;
}

async function replay(argv: string[]): Promise<void> {
	const state = await loadState();
	if (!state?.stop) throw new Error("no STOP to replay");
	if (state.next_required_action !== "REPLAY" && state.next_required_action !== "REPAIR") {
		throw new Error(`replay requires REPAIR/REPLAY, found ${state.next_required_action}`);
	}
	const workspace = workspaceSnapshot(PROJECT_ROOT, { base: option("--base", argv) });
	const files = workspace.files;
	const surfaces = await loadImpactSurfaces();
	const impact = classifyFiles(files, surfaces);
	const signature = sha256(impactSignature(impact, files));
	state.harnessHead = workspace.head;
	state.workingTreeDirty = workspace.dirty;
	state.delta = {
		files,
		classes: impact.classes,
		signature,
		unknownFiles: impact.unknownFiles.length > 0 ? impact.unknownFiles : undefined,
	};
	state.next_required_action = "REPLAY";
	const step = state.plan.steps.find(item => item.id === state.stop?.stepId);
	if (!step) throw new Error("STOP step is missing from the plan");
	const after = await runStep(state, step, "REPLAY", argv);
	process.stdout.write(`${JSON.stringify({
		sif: after.next_required_action === "REPAIR" ? "STOP" : "READY",
		next_required_action: after.next_required_action,
		outcomeClass: after.outcomeClass,
	}, null, 2)}\n`);
	if (after.next_required_action === "REPAIR") process.exitCode = 2;
}

async function status(): Promise<void> {
	const state = await loadState();
	if (!state) {
		process.stdout.write(`${JSON.stringify({ sif: "NO_STATE", next_required_action: "RUN_STEP", stateFile: STATE_FILE }, null, 2)}\n`);
		return;
	}
	const live = [...(await loadLedger()).records].reverse().find(record => record.step.backend === "live-continuous");
	process.stdout.write(`${JSON.stringify({
		sif: "STATUS",
		next_required_action: state.next_required_action,
		planId: state.planId,
		currentStep: state.plan.steps[state.currentStepIndex]?.id ?? null,
		outcomeClass: state.outcomeClass,
		stop: state.stop,
		dirty: state.workingTreeDirty,
		liveContinuous: live ? { id: live.id, kind: live.kind, at: live.at, failureClass: live.failureClass ?? null } : null,
	}, null, 2)}\n`);
}

async function main(): Promise<void> {
	const command = process.argv[2];
	if (command === "status") return status();
	if (command === "ingest") {
		const researchRoot = option("--research-root");
		if (!researchRoot) throw new Error("usage: bun sif/cli.ts ingest --research-root <path> [--session-dir <path>] [--snapshot] [--validator] [--summary]");
		const report = await ingestLiveRun({
			researchRoot,
			sessionDir: option("--session-dir"),
			snapshot: flag("--snapshot"),
			validator: flag("--validator"),
			writeLedger: flag("--no-ledger") ? false : undefined,
		});
		process.stdout.write(`${JSON.stringify(flag("--summary") ? report.summary : report, null, 2)}\n`);
		if (!report.mode || report.mode === "snapshot") return;
		if (report.failureClass) process.exitCode = 2;
		return;
	}
	if (command === "iterate") return iterate(process.argv);
	if (command === "replay") return replay(process.argv);
	if (command === "lock-bump") {
		const commit = option("--commit");
		if (!commit) throw new Error("usage: bun sif/cli.ts lock-bump --commit <sha>");
		const result = await lockBump({ commit, dryRun: flag("--dry-run") });
		process.stdout.write(result.output.endsWith("\n") ? result.output : `${result.output}\n`);
		if (result.pytestExit && result.pytestExit !== 0) process.exitCode = 1;
		return;
	}
	if (command === "certify") {
		const result = await certify({ requireRealModels: flag("--real-models"), allowDirty: flag("--allow-dirty") });
		process.stdout.write(`${JSON.stringify({ sif: result.ok ? "DONE" : "STOP", ...result, publish: "not_run" }, null, 2)}\n`);
		if (!result.ok) process.exitCode = 1;
		else {
			const state = await loadState();
			if (state) {
				state.next_required_action = "DONE";
				await saveState(state);
			}
		}
		return;
	}
	if (command === "trace") {
		const input = option("--codex") ?? option("--session");
		if (!input) throw new Error("usage: bun sif/cli.ts trace --codex <rollout.jsonl|forensics-session-dir>");
		const { resolveCodexRollout, compileCodexRollout, scoreCodexTrace } = await import("./codex");
		const rollout = await resolveCodexRollout(input);
		const htir = await compileCodexRollout(rollout);
		const report = { ...scoreCodexTrace(htir), rollout };
		process.stdout.write(`${JSON.stringify(flag("--summary") ? {
			sif: report.sif,
			kind: report.kind,
			usableAsIphLiveIngest: report.usableAsIphLiveIngest,
			rollout: report.rollout,
			stepCount: report.stepCount,
			toolCounts: report.toolCounts,
			m3HubWait: report.m3HubWait,
			unboundedSearch: report.unboundedSearch,
			spawnedTasks: report.spawnedTasks,
			yieldWaits: report.yieldWaits,
			processIssue: report.processIssue,
		} : report, null, 2)}\n`);
		return;
	}
	if (command === "flaws") {
		const ledger = await loadLedger();
		const flaws = consolidateFlaws(ledger);
		process.stdout.write(`${JSON.stringify({ sif: "FLAWS", count: flaws.length, flaws }, null, 2)}\n`);
		return;
	}
	throw new Error("usage: bun sif/cli.ts status|iterate|replay|ingest|trace|flaws|lock-bump|certify");
}

await main();
