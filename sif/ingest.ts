import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { ablationReport, type AblationLadder, type HarnessFixAblation } from "./ablation";
import { liveDiagnostics, type LiveDiagnostics } from "./diagnostics";
import { efficiencyFailureClass, efficiencyReport, resolveOutputType } from "./efficiency";
import { compileHtir } from "./htir";
import { appendLedger, artifactHash, reuseKey } from "./ledger";
import { attachFlawId, evolutionFromRepair } from "./flaws";
import { classifyTerminal, dispositionFromLog, lastDecisionAt, loggedStates, outcomeReady, type WorkflowSnapshot } from "./outcome";
import { projectionFidelity } from "./projection";
import { attributeFailure } from "./repair";
import { elicitationRegression, inferSpecialist, outcomeClassFor, scoreHtir } from "./scorecard";
import { filesShaFromLock, PROJECT_ROOT, RUNS_DIR, sha256 } from "./state";
import type { FailureClass, OutcomeClass, RoleScorecard } from "./types";
import { workspaceSnapshot } from "./workspace";

type JsonObject = Record<string, unknown>;

export interface IngestReport {
	sif: "SNAPSHOT" | "INGEST";
	mode: "snapshot" | "terminal";
	researchRoot: string;
	sessionDir: string;
	activeState?: string;
	terminalKind: ReturnType<typeof classifyTerminal>;
	outcomeReady: boolean;
	outcomeClass: OutcomeClass | null;
	failureClass?: FailureClass;
	processIssue?: string;
	efficiency?: ReturnType<typeof efficiencyReport>;
	diagnostics?: LiveDiagnostics;
	ablation?: AblationLadder & { rq3: HarnessFixAblation };
	projection?: ReturnType<typeof projectionFidelity>;
	summary?: Record<string, unknown>;
	scorecard: RoleScorecard;
	htirPath?: string;
	reportPath?: string;
	ledgerId?: string;
	validator: "ran" | "skipped" | "failed";
	validatorOutput?: string;
	mutatedResearchRoot: false;
}

async function exists(file: string): Promise<boolean> {
	return stat(file).then(() => true).catch(() => false);
}

function asObject(value: unknown): JsonObject {
	return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

export async function resolveSessionDir(researchRoot: string, sessionDir?: string): Promise<string> {
	if (sessionDir) return path.resolve(sessionDir);
	const root = path.join(path.resolve(researchRoot), ".harness-sessions");
	if (!await exists(root)) throw new Error(`no .harness-sessions under ${researchRoot}`);
	return root;
}

async function loadJson(file: string): Promise<JsonObject> {
	return asObject(JSON.parse(await readFile(file, "utf8")));
}

async function writeRunArtifact(runId: string, name: string, contents: string, runsDir = RUNS_DIR): Promise<{ path: string; sha256: string }> {
	const directory = path.join(runsDir, runId);
	await mkdir(directory, { recursive: true });
	const file = path.join(directory, name);
	await writeFile(file, contents);
	return { path: path.relative(PROJECT_ROOT, file), sha256: artifactHash(contents) };
}

async function runValidator(researchRoot: string): Promise<{ ok: boolean; output: string }> {
	const skillDir = process.env.IPH_SKILL_DIR?.trim();
	if (!skillDir) return { ok: false, output: "IPH_SKILL_DIR is unset; validator skipped" };
	const python = process.env.IPH_PYTHON?.trim() || "python3";
	const child = Bun.spawn([
		python,
		path.join(skillDir, "scripts", "iph.py"),
		"validate",
		"--root",
		researchRoot,
		"--state",
		path.join(researchRoot, "workflow_state.json"),
	], { cwd: researchRoot, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { ok: exitCode === 0, output: `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}` };
}

export async function ingestLiveRun(options: {
	researchRoot: string;
	sessionDir?: string;
	snapshot?: boolean;
	validator?: boolean;
	writeLedger?: boolean;
	ledgerFile?: string;
	runsDir?: string;
}): Promise<IngestReport> {
	const researchRoot = path.resolve(options.researchRoot);
	if (options.snapshot && options.validator) {
		throw new Error("refusing to run the Python validator against a snapshot of a live research root; it rebuilds lifecycle_state.json");
	}
	const sessionDir = await resolveSessionDir(researchRoot, options.sessionDir);
	const workflow = await loadJson(path.join(researchRoot, "workflow_state.json")) as WorkflowSnapshot;
	const harnessRun = await loadJson(path.join(researchRoot, "harness_run.json")).catch(() => ({} as JsonObject));
	const stopLock = await exists(path.join(researchRoot, ".workflow_stop.lock"));
	const terminalKind = classifyTerminal(workflow, { stopLock });
	if (terminalKind === "in_progress" && !options.snapshot) {
		throw new Error(`research root is still ${workflow.active_state ?? "unknown"}; wait for a terminal or pass --snapshot`);
	}

	const htir = await compileHtir({ traceRoot: sessionDir, researchRoot });
	const specialist = inferSpecialist(htir);
	const disposition = dispositionFromLog(workflow);
	const scorecard = scoreHtir(htir, { specialist, disposition });
	const inProgress = options.snapshot === true || terminalKind === "in_progress";
	const processIssue = elicitationRegression(scorecard, { specialist, inProgress, htir });
	const ready = !inProgress && outcomeReady(terminalKind);
	const diagnostics = liveDiagnostics(htir, workflow, harnessRun);
	diagnostics.projection = projectionFidelity({
		htir,
		activeState: typeof workflow.active_state === "string" ? workflow.active_state : undefined,
		outcomeReady: ready,
	});
	const efficiency = efficiencyReport({
		loggedStates: loggedStates(workflow),
		terminal: terminalKind !== "in_progress" && terminalKind !== "stop",
		stopped: !options.snapshot,
		snapshot: Boolean(options.snapshot),
		startedAt: typeof harnessRun.started_at === "string" ? harnessRun.started_at : undefined,
		budgetMs: typeof harnessRun.budget_ms === "number" ? harnessRun.budget_ms : undefined,
		endedAt: lastDecisionAt(workflow),
		diagnostics,
		outputType: resolveOutputType(workflow.output_type ?? harnessRun.output_type),
		nodeDurationsMs: Object.fromEntries(diagnostics.nodeDwell.map(item => [item.state, item.ms])),
	});

	let validator: IngestReport["validator"] = "skipped";
	let validatorOutput: string | undefined;
	if (options.validator && !options.snapshot) {
		const result = await runValidator(researchRoot);
		validator = result.ok ? "ran" : "failed";
		validatorOutput = result.output;
	}

	const validatorBlocks = validator === "failed";
	const outcomeIsReady = ready && !validatorBlocks;
	let failureClass: FailureClass | undefined;
	if (!inProgress && !outcomeIsReady) failureClass = "CONTRACT_FAIL";
	else if (!inProgress) failureClass = efficiencyFailureClass(efficiency);
	if (!failureClass && !inProgress && processIssue) failureClass = "ELICITATION_REGRESSION";
	if (!failureClass && !inProgress && diagnostics.projection && !diagnostics.projection.ok) {
		failureClass = "CONTRACT_FAIL";
	}

	const baseOutcome = inProgress
		? null
		: outcomeClassFor({ outcomeReady: outcomeIsReady, scorecard, specialist, inProgress: false, htir });
	const assisted = (htir.sessionExits ?? []).some(item => item.reason === "sigterm" || item.reason === "dispose");
	const outcomeClass = inProgress
		? null
		: !outcomeIsReady
			? "failed"
			: (diagnostics.unboundedSearch.length > 0 || (efficiency.skipAxes.length > 0))
				? "unsafe_invalid"
				: assisted && !processIssue
					? "assisted_verified_success"
					: baseOutcome;
	if (!inProgress && outcomeClass === "unsafe_invalid" && !failureClass) {
		failureClass = "EFFICIENCY_REGRESSION";
	}
	const ablation = ablationReport({
		outcomeReady: outcomeIsReady,
		scorecard,
		efficiency,
		diagnostics,
		processIssue,
	});

	const runId = randomUUID();
	const runsDir = options.runsDir ?? RUNS_DIR;
	const htirArtifact = await writeRunArtifact(runId, "live.htir.json", `${JSON.stringify(htir, null, 2)}\n`, runsDir);
	const report: IngestReport = {
		sif: options.snapshot ? "SNAPSHOT" : "INGEST",
		mode: options.snapshot ? "snapshot" : "terminal",
		researchRoot,
		sessionDir,
		activeState: typeof workflow.active_state === "string" ? workflow.active_state : htir.activeState,
		terminalKind,
		outcomeReady: outcomeIsReady,
		outcomeClass,
		failureClass,
		processIssue,
		efficiency,
		diagnostics,
		ablation,
		projection: diagnostics.projection,
		summary: {
			activeState: typeof workflow.active_state === "string" ? workflow.active_state : htir.activeState,
			nextRequiredAction: diagnostics.nextRequiredAction,
			terminalKind,
			processIssue,
			efficiencyIssue: efficiency.issue,
			m3HubWait: diagnostics.m3HubWait,
			hubOps: diagnostics.hubOps,
			duplicateAdvances: diagnostics.duplicateAdvances,
			pending: diagnostics.pendingToolCalls.map(item => `${item.toolName}${item.op ? `:${item.op}` : ""}`),
			sessionExits: diagnostics.sessionExits,
			nodeOverrun: diagnostics.nodeDwell.filter(item => item.overrun).map(item => item.state),
			unboundedSearch: diagnostics.unboundedSearch.length,
			invalidToolCalls: scorecard.invalidToolCalls,
			projection: diagnostics.projection,
			ablation,
		},
		scorecard,
		htirPath: htirArtifact.path,
		validator,
		validatorOutput,
		mutatedResearchRoot: false,
	};

	const shouldLedger = (options.writeLedger ?? !options.snapshot) && !inProgress;
	if (shouldLedger) {
		const workspace = workspaceSnapshot();
		const iphLock = await filesShaFromLock();
		const key = reuseKey({
			iphLock,
			layer: "L5",
			node: null,
			harnessContractHash: sha256(`live-continuous:${researchRoot}:${workflow.active_state ?? ""}`),
		});
		const repairSpec = failureClass
			? attributeFailure({
				failureClass,
				message: processIssue ?? efficiency.issue ?? `terminal=${terminalKind}`,
				steps: htir.steps,
			})
			: undefined;
		const evolutionCandidate = repairSpec
			? evolutionFromRepair(repairSpec, { deleteScaffold: failureClass === "ELICITATION_REGRESSION" })
			: null;
		const record = await appendLedger({
			kind: failureClass ? "FAIL" : "PASS",
			harnessHead: workspace.head,
			iphLock,
			reuseKey: key,
			step: { layer: "L5", node: null, backend: "live-continuous" },
			failureClass: failureClass ?? null,
			evolutionCandidate,
			artifacts: { htir: htirArtifact },
			scorecard,
			flawId: repairSpec ? attachFlawId({
				failureClass,
				evolutionCandidate,
				artifacts: { htir: htirArtifact },
				step: { layer: "L5", node: null, backend: "live-continuous" },
				repairSpec,
			}) : null,
		}, options.ledgerFile);
		report.ledgerId = record.id;
	}
	const reportArtifact = await writeRunArtifact(runId, "live.ingest.json", `${JSON.stringify(report, null, 2)}\n`, runsDir);
	report.reportPath = reportArtifact.path;
	return report;
}
