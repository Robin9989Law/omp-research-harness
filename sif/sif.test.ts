import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { efficiencyFailureClass, efficiencyReport, skipAxes } from "./efficiency";
import { regressionAwareAccept, heldOutRegressed } from "./accept";
import { compileHtir, compileTraceLinks } from "./htir";
import { attachFlawId, consolidateFlaws } from "./flaws";
import { liveDiagnostics, projectFrontierLabor } from "./diagnostics";
import { ingestLiveRun } from "./ingest";
import { classifyTerminal, outcomeReady } from "./outcome";
import { classifyFiles, globMatch, loadImpactSurfaces } from "./impact";
import { appendLedger, firstFailFor, loadLedger, reuseKey, saveLedger } from "./ledger";
import { hashFiles, statesMatch, writeCandidateLock } from "./lock-bump";
import { buildPlan } from "./plan";
import { attributeFailure } from "./repair";
import { elicitationRegression, outcomeClassFor, scoreHtir } from "./scorecard";
import { assertState, cannotRerun, executionKey, markExecuted, sha256, validateIterationState } from "./state";
import { certify } from "./certify";
import { SCHEMA_VERSION, SCORECARD_SCHEMA, type IterationState } from "./types";

const sampleState = (overrides: Partial<IterationState> = {}): IterationState => ({
	schemaVersion: SCHEMA_VERSION,
	scorecardSchema: SCORECARD_SCHEMA,
	harnessHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	workingTreeDirty: true,
	iphLock: { commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", filesSha: "c".repeat(64) },
		delta: { files: ["agents/frontier-auditor.md"], classes: ["prompt"], signature: "sig", unknownFiles: [] },
	planId: "plan-1",
	plan: {
		steps: [{ id: "L0-typecheck+system-matrix", layer: "L0", backend: "typecheck+system-matrix", oracle: "outcome" }],
	},
	currentStepIndex: 0,
	next_required_action: "RUN_STEP",
	outcomeClass: null,
	executedKeys: [],
	...overrides,
});

describe("SIF contract", () => {
	test("rejects a second RUN with the same planId/step/failure code", () => {
		const state = sampleState();
		markExecuted(state, "L0-typecheck+system-matrix", "RUN");
		expect(cannotRerun(state, "L0-typecheck+system-matrix", "RUN")).toBeTrue();
		expect(executionKey(state.planId, "L0-typecheck+system-matrix", "RUN")).toContain("plan-1");
	});

	test("accepts a valid iteration_state and rejects a missing repairSpec", () => {
		expect(validateIterationState(sampleState())).toEqual([]);
		expect(validateIterationState({ ...sampleState(), next_required_action: "NOPE" })).not.toEqual([]);
		const broken = sampleState({
			next_required_action: "REPAIR",
			stop: {
				failureClass: "CONTRACT_FAIL",
				stepId: "L0",
				message: "fail",
				repairSpec: {
					operator: "",
					layer: "Verification",
					anchors: [],
					regressionSet: [],
					concern: "",
					evidence: "",
					suggestion: "",
				},
			},
		});
		expect(validateIterationState(broken).some(issue => issue.includes("repairSpec"))).toBeTrue();
		expect(assertState(sampleState()).schemaVersion).toBe("1.0");
	});
});

describe("SIF impact map", () => {
	test("maps frontier-auditor.md to Node 3–4 and ablation", async () => {
		const impact = classifyFiles(["agents/frontier-auditor.md"], await loadImpactSurfaces());
		expect(impact.nodes).toEqual([3, 4]);
		expect(impact.layers).toContain("L5");
		expect(impact.ablation).toBeTrue();
		expect(impact.classes).toContain("prompt");
	});

	test("unknown paths conservatively require L0–L4", async () => {
		const impact = classifyFiles(["mystery/new-thing.ts"], await loadImpactSurfaces());
		expect(impact.unknownFiles).toEqual(["mystery/new-thing.ts"]);
		expect(impact.layers).toEqual(["L0", "L1", "L2", "L3", "L4"]);
		expect(impact.classes).toContain("unknown");
	});

	test("iph-lock.json requires deterministic node fixtures", async () => {
		const impact = classifyFiles(["config/iph-lock.json"], await loadImpactSurfaces());
		expect(impact.nodesRequired).toBeTrue();
		expect(impact.classes).toContain("validator");
		const plan = buildPlan(impact);
		expect(plan.steps.some(step => step.backend === "test-nodes")).toBeTrue();
	});

	test("globMatch treats ** as recursive", () => {
		expect(globMatch("sif/**", "sif/cli.ts")).toBeTrue();
		expect(globMatch("sif/**", "extensions/iph.ts")).toBeFalse();
	});
});

describe("HTIR-lite", () => {
	test("distinguishes message-only tool calls from lifecycle completed and unwraps xd://iph_*", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "sif-htir-"));
		try {
			await writeFile(path.join(root, "session.jsonl"), `${JSON.stringify({
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "toolCall", name: "write", arguments: { path: "xd://iph_advance" } }],
				},
			})}\n${JSON.stringify({
				type: "task:subagent:lifecycle",
				agent: "frontier-auditor",
				status: "completed",
			})}\n`);
			const htir = await compileHtir({ traceRoot: root });
			expect(htir.steps[0]?.name).toBe("iph_advance");
			expect(htir.steps[0]?.bridgedTool).toBe("write");
			expect(htir.steps[0]?.isMessageOnly).toBeTrue();
			expect(htir.steps[0]?.isLifecycleCompleted).toBeFalse();
			expect(htir.steps[1]?.isLifecycleCompleted).toBeTrue();
			expect(htir.steps[1]?.anchor).toBe("agents/frontier-auditor.md");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("captures specialistDisposition from iph_advance and skips node_modules", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "sif-htir-disp-"));
		try {
			await writeFile(path.join(root, "session.jsonl"), `${JSON.stringify({
				type: "message",
				message: {
					role: "assistant",
					content: [{
						type: "toolCall",
						name: "iph_advance",
						arguments: { to: "RECENT_FRONTIER", specialistDisposition: "ACCEPTED", specialistAgentId: "frontier-auditor" },
					}],
				},
			})}\n`);
			await mkdir(path.join(root, "node_modules"), { recursive: true });
			await writeFile(path.join(root, "node_modules", "noise.jsonl"), `${JSON.stringify({
				type: "message",
				message: { role: "assistant", content: [{ type: "toolCall", name: "ipc_call", arguments: {} }] },
			})}\n`);
			const htir = await compileHtir({ traceRoot: root });
			expect(htir.steps).toHaveLength(1);
			expect(htir.steps[0]?.disposition).toBe("ACCEPTED");
			expect(htir.steps[0]?.targetState).toBe("RECENT_FRONTIER");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("dedupes toolCall ids and records session_exit pending tools", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "sif-htir-exit-"));
		try {
			await writeFile(path.join(root, "session.jsonl"), `${JSON.stringify({
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "toolCall", id: "call_wait", name: "hub", arguments: { op: "wait", timeoutMs: 1000 }, intent: "wait for specialist" }],
				},
			})}\n${JSON.stringify({
				type: "custom",
				customType: "tool_execution_start",
				data: { toolCallId: "call_wait", toolName: "hub", startedAt: "2026-08-14T15:00:00.000Z", args: { op: "wait" }, intent: "wait for specialist" },
			})}\n${JSON.stringify({
				type: "custom",
				customType: "session_exit",
				data: {
					reason: "sigterm",
					recordedAt: "2026-08-14T15:01:00.000Z",
					pendingToolCalls: [{ toolName: "hub", toolCallId: "call_wait", args: { op: "wait" }, intent: "wait for specialist" }],
				},
			})}\n`);
			const htir = await compileHtir({ traceRoot: root });
			expect(htir.steps.filter(step => step.callId === "call_wait")).toHaveLength(1);
			expect(htir.steps[0]?.isMessageOnly).toBeFalse();
			expect(htir.steps[0]?.op).toBe("wait");
			expect(htir.steps[0]?.timeoutMs).toBe(1000);
			expect(htir.pendingToolCalls?.[0]?.toolName).toBe("hub");
			expect(htir.sessionExits?.[0]?.reason).toBe("sigterm");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("inherits specialist role from nested session filename", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "sif-htir-role-"));
		try {
			await mkdir(path.join(root, "FrontierAuditRecentXAI"), { recursive: true });
			await writeFile(path.join(root, "FrontierAuditRecentXAI", "session.jsonl"), `${JSON.stringify({
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "toolCall", name: "hub", arguments: { op: "wait" } }],
				},
			})}\n`);
			const htir = await compileHtir({ traceRoot: root });
			expect(htir.steps[0]?.role).toBe("frontier-auditor");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("role scorecard", () => {
	test("outcome-only layers with empty HTIR certify as autonomous_verified_success", () => {
		const htir = { schemaVersion: "1.0" as const, steps: [] };
		const scorecard = scoreHtir(htir);
		expect(scorecard.loops[0]?.finishedEfficiently).toBeFalse();
		expect(outcomeClassFor({ outcomeReady: true, scorecard })).toBe("unverified_success");
		expect(outcomeClassFor({ outcomeReady: true, scorecard, htir })).toBe("autonomous_verified_success");
	});

	test("specialist edges without disposition are unverified even if the outcome is ready", () => {
		const scorecard = scoreHtir({
			schemaVersion: "1.0",
			steps: [
				{
					id: 1,
					sourceFile: "a.jsonl",
					role: "M3",
					status: "message",
					effect: "read",
					name: "iph_status",
					isLifecycleCompleted: false,
					isMessageOnly: true,
					etcLayer: "Context",
					anchor: "extensions/iph.ts",
				},
				{
					id: 2,
					sourceFile: "a.jsonl",
					role: "M3",
					status: "message",
					effect: "read",
					name: "iph_transition_plan",
					isLifecycleCompleted: false,
					isMessageOnly: true,
					etcLayer: "Context",
					anchor: "extensions/iph.ts",
				},
				{
					id: 3,
					sourceFile: "a.jsonl",
					role: "M3",
					status: "message",
					effect: "state",
					name: "iph_advance",
					isLifecycleCompleted: false,
					isMessageOnly: true,
					etcLayer: "Verification",
					anchor: "extensions/iph.ts",
				},
			],
		}, { specialist: "frontier-auditor" });
		expect(elicitationRegression(scorecard, { specialist: "frontier-auditor" })).toContain("disposition");
		expect(outcomeClassFor({ outcomeReady: true, scorecard, specialist: "frontier-auditor" })).toBe("unverified_success");
	});

	test("a continuous session may spawn more than one specialist task", () => {
		const step = (id: number, name: string, extras: Partial<import("./types").TraceStep> = {}): import("./types").TraceStep => ({
			id,
			sourceFile: "a.jsonl",
			role: extras.role ?? "M3",
			status: extras.status ?? "message",
			effect: extras.effect ?? "read",
			name,
			isLifecycleCompleted: extras.isLifecycleCompleted ?? false,
			isMessageOnly: extras.isMessageOnly ?? true,
			etcLayer: extras.etcLayer ?? "Context",
			anchor: extras.anchor ?? "extensions/iph.ts",
			...extras,
		});
		const scorecard = scoreHtir({
			schemaVersion: "1.0",
			steps: [
				step(1, "iph_status"),
				step(2, "iph_transition_plan"),
				step(3, "task"),
				step(4, "iph_advance", { effect: "state", etcLayer: "Verification", disposition: "ACCEPTED", specialistAgentId: "frontier-auditor" }),
				step(5, "iph_status"),
				step(6, "iph_transition_plan"),
				step(7, "task"),
				step(8, "iph_advance", { effect: "state", etcLayer: "Verification", disposition: "ACCEPTED", specialistAgentId: "layer-adjudicator" }),
				step(9, "task:subagent:lifecycle", {
					role: "frontier-auditor",
					isLifecycleCompleted: true,
					isMessageOnly: false,
					status: "completed",
					etcLayer: "Lifecycle",
					anchor: "agents/frontier-auditor.md",
				}),
				step(10, "task:subagent:lifecycle", {
					role: "layer-adjudicator",
					isLifecycleCompleted: true,
					isMessageOnly: false,
					status: "completed",
					etcLayer: "Lifecycle",
					anchor: "agents/layer-adjudicator.md",
				}),
			],
		}, { specialist: "frontier-auditor" });
		expect(elicitationRegression(scorecard, { specialist: "frontier-auditor" })).toBeUndefined();
		expect(outcomeClassFor({ outcomeReady: true, scorecard, specialist: "frontier-auditor" })).toBe("autonomous_verified_success");
	});

	test("hub or ipc_call is an elicitation regression", () => {
		const scorecard = scoreHtir({
			schemaVersion: "1.0",
			steps: [{
				id: 1,
				sourceFile: "a.jsonl",
				role: "M3",
				status: "message",
				effect: "unknown",
				name: "hub",
				isLifecycleCompleted: false,
				isMessageOnly: true,
				etcLayer: "Observability",
				anchor: "SYSTEM.md",
			}],
		});
		expect(elicitationRegression(scorecard)).toContain("hub");
	});

	test("specialist hub pty does not count as M3 hub-wait", () => {
		const scorecard = scoreHtir({
			schemaVersion: "1.0",
			steps: [
				{
					id: 1,
					sourceFile: "a.jsonl",
					role: "M3",
					status: "message",
					effect: "read",
					name: "iph_status",
					isLifecycleCompleted: false,
					isMessageOnly: true,
					etcLayer: "Context",
					anchor: "extensions/iph.ts",
				},
				{
					id: 2,
					sourceFile: "a.jsonl",
					role: "M3",
					status: "message",
					effect: "read",
					name: "iph_transition_plan",
					isLifecycleCompleted: false,
					isMessageOnly: true,
					etcLayer: "Context",
					anchor: "extensions/iph.ts",
				},
				{
					id: 3,
					sourceFile: "a.jsonl",
					role: "M3",
					status: "message",
					effect: "state",
					name: "iph_advance",
					isLifecycleCompleted: false,
					isMessageOnly: true,
					etcLayer: "Verification",
					anchor: "extensions/iph.ts",
				},
				{
					id: 4,
					sourceFile: "child.jsonl",
					role: "frontier-auditor",
					status: "started",
					effect: "unknown",
					name: "hub",
					op: "send",
					isLifecycleCompleted: false,
					isMessageOnly: false,
					etcLayer: "Observability",
					anchor: "agents/frontier-auditor.md",
				},
			],
		});
		expect(elicitationRegression(scorecard)).toBeUndefined();
	});
});

describe("ledger", () => {
	test("never overwrites a FAIL record and links a later PASS", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "sif-ledger-"));
		const file = path.join(root, "index.json");
		try {
			await saveLedger({ schemaVersion: "1.0", records: [] }, file);
			const key = reuseKey({
				iphLock: { commit: "a".repeat(40), filesSha: "b".repeat(64) },
				layer: "L5",
				node: 4,
				harnessContractHash: "hash",
			});
			const fail = await appendLedger({
				kind: "FAIL",
				harnessHead: "h",
				iphLock: { commit: "a".repeat(40), filesSha: "b".repeat(64) },
				reuseKey: key,
				step: { layer: "L5", node: 4, backend: "real-model-nodes" },
				failureClass: "CONTRACT_FAIL",
			}, file);
			await expect(appendLedger({ ...fail, kind: "PASS" }, file)).rejects.toThrow(/mutate existing record/);
			const pass = await appendLedger({
				kind: "PASS",
				harnessHead: "h",
				iphLock: { commit: "a".repeat(40), filesSha: "b".repeat(64) },
				reuseKey: key,
				step: { layer: "L5", node: 4, backend: "real-model-nodes" },
			}, file);
			const index = await loadLedger(file);
			expect(firstFailFor(index, key)?.id).toBe(fail.id);
			expect(pass.firstFailId).toBe(fail.id);
			expect(index.records.filter(record => record.id === fail.id && record.kind === "FAIL")).toHaveLength(1);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("lock-bump and certify", () => {
	test("recomputes file hashes into a candidate lock without touching config/iph-lock.json", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "sif-lock-"));
		try {
			await writeFile(path.join(root, "SKILL.md"), "skill\n");
			const files = await hashFiles(root, ["SKILL.md"]);
			expect(files["SKILL.md"]).toBe(sha256("skill\n"));
			const candidate = await writeCandidateLock({
				commit: "d".repeat(40),
				repository: "https://github.com/Robin9989Law/innovation-proposition-hunting",
				files,
				runDir: path.join(root, "run"),
			});
			expect(candidate).toContain("iph-lock.candidate.json");
			expect(JSON.parse(await readFile(candidate, "utf8")).commit).toHaveLength(40);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("statesMatch reports Python/TS drift", () => {
		expect(statesMatch(["BLOCKED", ...sampleState().plan.steps.map(() => "BOOT")]).length).toBeGreaterThan(0);
	});

	test("certify refuses unverified_success and dirty trees", async () => {
		const dirty = await certify({
			state: sampleState({ next_required_action: "CERTIFY", outcomeClass: "autonomous_verified_success" }),
			dirtyPorcelain: " M extensions/iph.ts",
		});
		expect(dirty.ok).toBeFalse();
		expect(dirty.issues.some(issue => issue.includes("dirty"))).toBeTrue();
		const unverified = await certify({
			state: sampleState({ next_required_action: "CERTIFY", outcomeClass: "unverified_success", workingTreeDirty: false }),
			allowDirty: true,
			dirtyPorcelain: "",
		});
		expect(unverified.ok).toBeFalse();
		expect(unverified.issues.some(issue => issue.includes("unverified_success"))).toBeTrue();
	});

	test("live-continuous PASS satisfies deferred L5 for certify --real-models", async () => {
		const missing = await certify({
			state: sampleState({
				next_required_action: "CERTIFY",
				outcomeClass: "autonomous_verified_success",
				workingTreeDirty: false,
				deferred: ["L5"],
				passK: 2,
			}),
			allowDirty: true,
			dirtyPorcelain: "",
			requireRealModels: true,
			ledger: { schemaVersion: "1.0", records: [] },
		});
		expect(missing.issues.some(issue => issue.includes("L5"))).toBeTrue();
		const live = await certify({
			state: sampleState({
				next_required_action: "CERTIFY",
				outcomeClass: "autonomous_verified_success",
				workingTreeDirty: false,
				deferred: ["L5"],
				passK: 2,
			}),
			allowDirty: true,
			dirtyPorcelain: "",
			requireRealModels: true,
			ledger: {
				schemaVersion: "1.0",
				records: [{
					id: "live-1",
					kind: "PASS",
					at: "2026-08-14T00:00:00.000Z",
					harnessHead: "h",
					iphLock: { commit: "b".repeat(40), filesSha: "c".repeat(64) },
					reuseKey: "k",
					step: { layer: "L5", node: null, backend: "live-continuous" },
				}],
			},
		});
		expect(live.issues.some(issue => issue.includes("L5"))).toBeFalse();
		const assisted = await certify({
			state: sampleState({
				next_required_action: "CERTIFY",
				outcomeClass: "assisted_verified_success",
				workingTreeDirty: false,
			}),
			allowDirty: true,
			dirtyPorcelain: "",
			ledger: { schemaVersion: "1.0", records: [] },
		});
		expect(assisted.issues.some(issue => issue.includes("assisted_verified_success"))).toBeTrue();
	});

	test("isolated L5 pass^k counts independent trials, not duplicate PASS rows", async () => {
		const missing = await certify({
			state: sampleState({
				next_required_action: "CERTIFY",
				outcomeClass: "autonomous_verified_success",
				workingTreeDirty: false,
				deferred: ["L5"],
				passK: 2,
			}),
			allowDirty: true,
			dirtyPorcelain: "",
			requireRealModels: true,
			ledger: {
				schemaVersion: "1.0",
				records: [{
					id: "once",
					kind: "PASS",
					at: "2026-08-14T00:00:00.000Z",
					harnessHead: "h",
					iphLock: { commit: "b".repeat(40), filesSha: "c".repeat(64) },
					reuseKey: "k",
					step: { layer: "L5", node: 4, backend: "real-model-nodes" },
					isolatedTrials: 1,
				}],
			},
		});
		expect(missing.issues.some(issue => issue.includes("independent isolated trials"))).toBeTrue();
		const twoTrials = await certify({
			state: sampleState({
				next_required_action: "CERTIFY",
				outcomeClass: "autonomous_verified_success",
				workingTreeDirty: false,
				deferred: ["L5"],
				passK: 2,
			}),
			allowDirty: true,
			dirtyPorcelain: "",
			requireRealModels: true,
			ledger: {
				schemaVersion: "1.0",
				records: [{
					id: "k2",
					kind: "PASS",
					at: "2026-08-14T00:00:00.000Z",
					harnessHead: "h",
					iphLock: { commit: "b".repeat(40), filesSha: "c".repeat(64) },
					reuseKey: "k",
					step: { layer: "L5", node: 4, backend: "real-model-nodes" },
					isolatedTrials: 2,
				}],
			},
		});
		expect(twoTrials.issues.some(issue => issue.includes("L5"))).toBeFalse();
	});

	test("L6 prompt ablation can be satisfied by an L6 PASS", async () => {
		const missing = await certify({
			state: sampleState({
				next_required_action: "CERTIFY",
				outcomeClass: "autonomous_verified_success",
				workingTreeDirty: false,
				deferred: ["L6"],
			}),
			allowDirty: true,
			dirtyPorcelain: "",
			ledger: { schemaVersion: "1.0", records: [] },
		});
		expect(missing.issues.some(issue => issue.includes("L6"))).toBeTrue();
		const satisfied = await certify({
			state: sampleState({
				next_required_action: "CERTIFY",
				outcomeClass: "autonomous_verified_success",
				workingTreeDirty: false,
				deferred: ["L6"],
			}),
			allowDirty: true,
			dirtyPorcelain: "",
			ledger: {
				schemaVersion: "1.0",
				records: [{
					id: "l6",
					kind: "PASS",
					at: "2026-08-14T00:00:00.000Z",
					harnessHead: "h",
					iphLock: { commit: "b".repeat(40), filesSha: "c".repeat(64) },
					reuseKey: "k",
					step: { layer: "L6", backend: "scaffold-ablation" },
				}],
			},
		});
		expect(satisfied.issues.some(issue => issue.includes("L6"))).toBeFalse();
	});

	test("repair specs are scoped operators, not free-form edits", () => {
		const spec = attributeFailure({
			failureClass: "ELICITATION_REGRESSION",
			message: "no disposition",
		});
		expect(spec.operator).toBe("delete_suppressing_scaffold");
		expect(spec.suggestion).toContain("Do not add step scripts");
		const hub = attributeFailure({
			failureClass: "ELICITATION_REGRESSION",
			message: "M3 polled specialist with hub wait instead of task lifecycle",
		});
		expect(hub.operator).toBe("restore_task_lifecycle");
		const skip = attributeFailure({
			failureClass: "EFFICIENCY_REGRESSION",
			message: "skip-axes: SCOPE_LOCK->RECENT_FRONTIER skipped PRIOR_CLAIM_DRAIN",
		});
		expect(skip.operator).toBe("restore_adjacent_commit");
	});

	test("regression-aware accept requires target gone, held-out intact, and scorecard not worse", () => {
		const before = scoreHtir({
			schemaVersion: "1.0",
			steps: [{
				id: 1,
				sourceFile: "a.jsonl",
				role: "M3",
				status: "message",
				effect: "state",
				name: "iph_advance",
				isLifecycleCompleted: false,
				isMessageOnly: true,
				etcLayer: "Verification",
				anchor: "extensions/iph.ts",
			}],
		});
		const after = scoreHtir({
			schemaVersion: "1.0",
			steps: [
				{
					id: 1,
					sourceFile: "a.jsonl",
					role: "M3",
					status: "message",
					effect: "read",
					name: "iph_status",
					isLifecycleCompleted: false,
					isMessageOnly: true,
					etcLayer: "Context",
					anchor: "extensions/iph.ts",
				},
				{
					id: 2,
					sourceFile: "a.jsonl",
					role: "M3",
					status: "message",
					effect: "read",
					name: "iph_transition_plan",
					isLifecycleCompleted: false,
					isMessageOnly: true,
					etcLayer: "Context",
					anchor: "extensions/iph.ts",
				},
				{
					id: 3,
					sourceFile: "a.jsonl",
					role: "M3",
					status: "message",
					effect: "state",
					name: "iph_advance",
					isLifecycleCompleted: false,
					isMessageOnly: true,
					etcLayer: "Verification",
					anchor: "extensions/iph.ts",
				},
			],
		});
		expect(regressionAwareAccept({ before, after, targetGone: true, heldOutStillPass: true }).accept).toBeTrue();
		expect(regressionAwareAccept({ before, after, targetGone: false, heldOutStillPass: true }).accept).toBeFalse();
		expect(heldOutRegressed({
			schemaVersion: "1.0",
			records: [
				{
					id: "p",
					kind: "PASS",
					at: "2026-08-14T00:00:00.000Z",
					harnessHead: "h",
					iphLock: { commit: "b".repeat(40), filesSha: "c".repeat(64) },
					reuseKey: "other",
					step: { layer: "L1", backend: "bun-test" },
				},
				{
					id: "f",
					kind: "FAIL",
					at: "2026-08-14T01:00:00.000Z",
					harnessHead: "h",
					iphLock: { commit: "b".repeat(40), filesSha: "c".repeat(64) },
					reuseKey: "other",
					step: { layer: "L1", backend: "bun-test" },
					failureClass: "CONTRACT_FAIL",
				},
			],
		}, "current")).toBeTrue();
		expect(heldOutRegressed({
			schemaVersion: "1.0",
			records: [
				{
					id: "p1",
					kind: "PASS",
					at: "2026-08-14T00:00:00.000Z",
					harnessHead: "h",
					iphLock: { commit: "b".repeat(40), filesSha: "c".repeat(64) },
					reuseKey: "other",
					step: { layer: "L1", backend: "bun-test" },
				},
				{
					id: "f1",
					kind: "FAIL",
					at: "2026-08-14T01:00:00.000Z",
					harnessHead: "h",
					iphLock: { commit: "b".repeat(40), filesSha: "c".repeat(64) },
					reuseKey: "other",
					step: { layer: "L1", backend: "bun-test" },
					failureClass: "CONTRACT_FAIL",
				},
				{
					id: "p2",
					kind: "PASS",
					at: "2026-08-14T02:00:00.000Z",
					harnessHead: "h",
					iphLock: { commit: "b".repeat(40), filesSha: "c".repeat(64) },
					reuseKey: "other",
					step: { layer: "L1", backend: "bun-test" },
				},
			],
		}, "current")).toBeFalse();
		expect(heldOutRegressed({
			schemaVersion: "1.0",
			records: [
				{
					id: "p3",
					kind: "PASS",
					at: "2026-08-14T00:00:00.000Z",
					harnessHead: "h",
					iphLock: { commit: "b".repeat(40), filesSha: "c".repeat(64) },
					reuseKey: "other",
					step: { layer: "L1", backend: "bun-test" },
				},
				{
					id: "r1",
					kind: "REPLAY",
					at: "2026-08-14T03:00:00.000Z",
					harnessHead: "h",
					iphLock: { commit: "b".repeat(40), filesSha: "c".repeat(64) },
					reuseKey: "other",
					step: { layer: "L1", backend: "bun-test" },
					failureClass: "CONTRACT_FAIL",
				},
			],
		}, "current")).toBeTrue();
	});

	test("HTIR control-flow links mark retry, delegate, and data produces across intermediate steps", () => {
		const base = {
			sourceFile: "a.jsonl",
			status: "message" as const,
			isLifecycleCompleted: false,
			isMessageOnly: true,
			etcLayer: "Verification" as const,
			anchor: "extensions/iph.ts",
		};
		const links = compileTraceLinks([
			{ ...base, id: 1, role: "M3", effect: "read", name: "iph_status", etcLayer: "Context" },
			{ ...base, id: 2, role: "M3", effect: "mixed", name: "task", etcLayer: "Execution" },
			{ ...base, id: 3, role: "frontier", status: "completed", effect: "artifact", name: "task:subagent:lifecycle", isLifecycleCompleted: true, isMessageOnly: false, etcLayer: "Execution", anchor: "agents/frontier-auditor.md" },
			{ ...base, id: 4, role: "M3", effect: "read", name: "iph_validate" },
			{ ...base, id: 5, role: "M3", effect: "state", name: "iph_advance", targetState: "SCOPE_LOCK" },
			{ ...base, id: 6, role: "M3", effect: "state", name: "iph_advance", targetState: "SCOPE_LOCK" },
			{ ...base, id: 7, role: "M3", effect: "mixed", name: "hub", op: "wait", etcLayer: "Lifecycle" },
			{ ...base, id: 8, role: "frontier", status: "completed", effect: "artifact", name: "task:subagent:lifecycle", isLifecycleCompleted: true, isMessageOnly: false, etcLayer: "Execution" },
		]);
		expect(links.some(link => link.sourceId === 1 && link.targetId === 5 && link.kind === "data" && link.relation === "produces")).toBeTrue();
		expect(links.some(link => link.sourceId === 2 && link.targetId === 3 && link.kind === "control" && link.relation === "delegate")).toBeTrue();
		expect(links.some(link => link.sourceId === 4 && link.targetId === 5 && link.kind === "control" && link.relation === "finalize")).toBeTrue();
		expect(links.some(link => link.sourceId === 5 && link.targetId === 6 && link.kind === "control" && link.relation === "retry")).toBeTrue();
		expect(links.some(link => link.sourceId === 1 && link.targetId === 5 && link.relation === "finalize")).toBeFalse();
		expect(links.some(link => link.sourceId === 7 && link.relation === "delegate")).toBeFalse();
	});

	test("FAIL records consolidate into HarnessFix-style flaw records", () => {
		const flaws = consolidateFlaws({
			schemaVersion: "1.0",
			records: [
				{
					id: "a",
					kind: "FAIL",
					at: "2026-08-14T00:00:00.000Z",
					harnessHead: "h",
					iphLock: { commit: "b".repeat(40), filesSha: "c".repeat(64) },
					reuseKey: "k1",
					step: { layer: "L5", backend: "live-continuous" },
					failureClass: "ELICITATION_REGRESSION",
					evolutionCandidate: { operator: "restore_task_lifecycle" },
					artifacts: { htir: { path: "x", sha256: "y" } },
				},
				{
					id: "b",
					kind: "FAIL",
					at: "2026-08-14T01:00:00.000Z",
					harnessHead: "h",
					iphLock: { commit: "b".repeat(40), filesSha: "c".repeat(64) },
					reuseKey: "k2",
					step: { layer: "L5", backend: "live-continuous" },
					failureClass: "ELICITATION_REGRESSION",
					evolutionCandidate: { operator: "restore_task_lifecycle" },
					artifacts: { htir: { path: "x", sha256: "y" } },
				},
			],
		});
		expect(flaws).toHaveLength(1);
		expect(flaws[0]?.count).toBe(2);
		expect(flaws[0]?.operator).toBe("restore_task_lifecycle");
		expect(flaws[0]?.anchor).toBe("live-continuous");
		expect(attachFlawId({
			failureClass: "CONTRACT_FAIL",
			evolutionCandidate: { operator: "fix_extension" },
			artifacts: { htir: { path: "x", sha256: "y" } },
			step: { layer: "L1", backend: "bun-test" },
			repairSpec: { anchors: ["extensions/iph.ts"] },
		})).toBe("CONTRACT_FAIL|fix_extension|extensions/iph.ts");
		expect(attachFlawId({
			failureClass: "CONTRACT_FAIL",
			evolutionCandidate: { operator: "fix_extension" },
			artifacts: { htir: { path: "x", sha256: "y" } },
			step: { layer: "L1", backend: "bun-test" },
		})).toBe("CONTRACT_FAIL|fix_extension|bun-test");
	});
});

describe("live ingest", () => {
	async function writeFrontierLabor(root: string, options: {
		censusSize: number;
		kSetSize?: number;
		routeStatus?: "COMPLETE" | "INCOMPLETE";
	}): Promise<void> {
		await writeFile(path.join(root, "near_neighbor_registry.json"), `${JSON.stringify({
			records: Array.from({ length: options.censusSize }, (_, index) => ({ registry_id: `W-${String(index + 1).padStart(4, "0")}` })),
		}, null, 2)}\n`);
		await writeFile(path.join(root, "frontier_coverage.json"), `${JSON.stringify({
			routes: [
				{ route_id: "citation", route_type: "CITATION_GRAPH", independent: true, status: options.routeStatus ?? "COMPLETE" },
				{ route_id: "forward", route_type: "FORWARD_CITATION", independent: true, status: options.routeStatus ?? "COMPLETE" },
			],
		}, null, 2)}\n`);
		await writeFile(path.join(root, "current_evidence_scope.json"), `${JSON.stringify({
			fulltext_registry_ids: Array.from({ length: options.kSetSize ?? 8 }, (_, index) => `W-${String(index + 1).padStart(4, "0")}`),
		}, null, 2)}\n`);
	}

	async function writeResearchRoot(options: {
		activeState: string;
		novelty?: string;
		states?: string[];
		outputType?: string;
		censusSize?: number;
		kSetSize?: number;
		routeStatus?: "COMPLETE" | "INCOMPLETE";
		hubWaits?: Array<{ timeoutMs: number; status?: "started" | "message"; op?: string }>;
	}): Promise<string> {
		const root = await mkdtemp(path.join(tmpdir(), "sif-live-"));
		const sessions = path.join(root, ".harness-sessions");
		await mkdir(sessions, { recursive: true });
		await writeFile(path.join(root, "workflow_state.json"), `${JSON.stringify({
			active_state: options.activeState,
			novelty_level: options.novelty ?? "N0-3",
			output_type: options.outputType ?? "JOURNAL_ARTICLE",
			decision_log: (options.states ?? ["SCOPE_LOCK", "PRIOR_CLAIM_DRAIN"]).map((state, index) => ({
				at: `2026-08-14T15:0${index}:00.000Z`,
				state,
				action: `commit ${state}`,
			})),
		}, null, 2)}\n`);
		await writeFile(path.join(root, "harness_run.json"), `${JSON.stringify({
			budget_ms: 2_700_000,
			started_at: "2026-08-14T14:56:52.416Z",
			deadline_state: "DIRECTION_LOCK",
			output_type: options.outputType ?? "JOURNAL_ARTICLE",
		}, null, 2)}\n`);
		if (options.censusSize != null) {
			await writeFrontierLabor(root, {
				censusSize: options.censusSize,
				kSetSize: options.kSetSize,
				routeStatus: options.routeStatus,
			});
		}
		const hubCalls = (options.hubWaits ?? []).map((wait, index) => ({
			type: wait.status === "started" ? "custom" : "message",
			customType: wait.status === "started" ? "tool_execution_start" : undefined,
			data: wait.status === "started"
				? { toolCallId: `wait_${index}`, toolName: "hub", args: { op: wait.op ?? "wait", timeoutMs: wait.timeoutMs } }
				: undefined,
			message: wait.status === "started" ? undefined : {
				role: "assistant",
				content: [{
					type: "toolCall",
					id: `wait_${index}`,
					name: "hub",
					arguments: { op: wait.op ?? "wait", timeoutMs: wait.timeoutMs },
				}],
			},
		}));
		await writeFile(path.join(sessions, "session.jsonl"), `${[
			{
				type: "message",
				message: {
					role: "assistant",
					content: [
						{ type: "toolCall", name: "iph_status", arguments: {} },
						{ type: "toolCall", name: "iph_transition_plan", arguments: {} },
						{ type: "toolCall", name: "iph_advance", arguments: { to: options.activeState } },
					],
				},
			},
			...hubCalls,
		].map(entry => JSON.stringify(entry)).join("\n")}\n`);
		return root;
	}

	const TO_N0_AUDIT = [
		"SCOPE_LOCK",
		"PRIOR_CLAIM_DRAIN",
		"RECENT_FRONTIER",
		"LITERATURE_REGISTER",
		"L1_FREEZE",
		"L2_TRIAGE",
		"LAYER_DECISION",
		"K_FULLTEXT",
		"K_CLAIM_REGISTER",
		"SYNTHESIZE_COLLISION",
		"OUTPUT_CLAIM_BIND",
		"EVIDENCE_VALIDATE",
		"N0_AUDIT",
	];

	test("skip-axes catch jumped states; overrun alone is not an efficiency failure", () => {
		expect(skipAxes(["SCOPE_LOCK", "RECENT_FRONTIER"]).some(item => item.includes("PRIOR_CLAIM_DRAIN"))).toBeTrue();
		const overrun = efficiencyReport({
			loggedStates: ["SCOPE_LOCK", "PRIOR_CLAIM_DRAIN"],
			terminal: true,
			stopped: true,
			snapshot: false,
			startedAt: "2026-08-14T14:00:00.000Z",
			endedAt: "2026-08-14T16:00:00.000Z",
			budgetMs: 60_000,
		});
		expect(overrun.overrun).toBeTrue();
		expect(overrun.issue).toBeUndefined();
		expect(efficiencyFailureClass(overrun)).toBeUndefined();
		const paced = efficiencyReport({
			loggedStates: ["SCOPE_LOCK", "PRIOR_CLAIM_DRAIN"],
			terminal: true,
			stopped: true,
			snapshot: false,
			outputType: "JOURNAL_ARTICLE",
			nodeDurationsMs: { PRIOR_CLAIM_DRAIN: 500_000 },
		});
		expect(paced.nodePacing?.nodeOverruns.length).toBeGreaterThan(0);
		expect(efficiencyFailureClass(paced)).toBeUndefined();
	});

	test("N0-3 at N0_AUDIT is a scoreable hold, not in-progress or success", () => {
		expect(classifyTerminal({ active_state: "N0_AUDIT", novelty_level: "N0-3" })).toBe("hold");
		expect(outcomeReady("hold")).toBeTrue();
		expect(classifyTerminal({ active_state: "PRIOR_CLAIM_DRAIN", novelty_level: "N0-3" })).toBe("in_progress");
		expect(classifyTerminal({ active_state: "N0_AUDIT", novelty_level: "N0-1" })).toBe("honest_negative");
		expect(projectFrontierLabor({
			outputType: "JOURNAL_ARTICLE",
			registry: { records: Array.from({ length: 9 }, (_, index) => ({ id: index })) },
			frontier: {
				routes: [
					{ route_type: "CITATION_GRAPH", independent: true, status: "INCOMPLETE" },
					{ route_type: "FORWARD_CITATION", independent: true, status: "INCOMPLETE" },
				],
			},
			evidenceScope: { fulltext_registry_ids: ["W-0001", "W-0002", "W-0003", "W-0004", "W-0005", "W-0006", "W-0007"] },
		})).toMatchObject({
			censusSize: 9,
			kSetSize: 7,
			thinFrontier: true,
			incompleteRequiredRoutes: ["CITATION_GRAPH", "FORWARD_CITATION"],
		});
		const idle = liveDiagnostics({
			schemaVersion: "1.0",
			steps: [
				{ id: 1, sourceFile: "a.jsonl", role: "M3", status: "started", effect: "unknown", name: "hub", op: "wait", timeoutMs: 120_000, isLifecycleCompleted: false, isMessageOnly: false, etcLayer: "Observability", anchor: "SYSTEM.md" },
				{ id: 2, sourceFile: "a.jsonl", role: "M3", status: "started", effect: "unknown", name: "hub", op: "wait", timeoutMs: 120_000, isLifecycleCompleted: false, isMessageOnly: false, etcLayer: "Observability", anchor: "SYSTEM.md" },
			],
		});
		expect(idle.shortHubWait).toBe(2);
		expect(idle.shortHubIdle).toBeTrue();
	});

	test("snapshot of an in-progress root does not write a ledger FAIL", async () => {
		const root = await writeResearchRoot({ activeState: "PRIOR_CLAIM_DRAIN" });
		const tmp = await mkdtemp(path.join(tmpdir(), "sif-ingest-out-"));
		try {
			await expect(ingestLiveRun({ researchRoot: root })).rejects.toThrow(/--snapshot/);
			const report = await ingestLiveRun({
				researchRoot: root,
				snapshot: true,
				ledgerFile: path.join(tmp, "index.json"),
				runsDir: path.join(tmp, "runs"),
			});
			expect(report.sif).toBe("SNAPSHOT");
			expect(report.mutatedResearchRoot).toBeFalse();
			expect(report.ledgerId).toBeUndefined();
			expect(report.outcomeClass).toBeNull();
			expect(report.summary).toBeDefined();
			expect(await loadLedger(path.join(tmp, "index.json"))).toEqual({ schemaVersion: "1.0", records: [] });
		} finally {
			await rm(root, { recursive: true, force: true });
			await rm(tmp, { recursive: true, force: true });
		}
	});

	test("terminal DIRECTION_LOCK ingest writes L5 live-continuous evidence", async () => {
		const root = await writeResearchRoot({
			activeState: "DIRECTION_LOCK",
			novelty: "N0-4C",
			censusSize: 20,
			kSetSize: 8,
			routeStatus: "COMPLETE",
			states: [
				"SCOPE_LOCK",
				"PRIOR_CLAIM_DRAIN",
				"RECENT_FRONTIER",
				"LITERATURE_REGISTER",
				"L1_FREEZE",
				"L2_TRIAGE",
				"LAYER_DECISION",
				"K_FULLTEXT",
				"K_CLAIM_REGISTER",
				"SYNTHESIZE_COLLISION",
				"OUTPUT_CLAIM_BIND",
				"EVIDENCE_VALIDATE",
				"N0_AUDIT",
				"CLAIM_FREEZE",
				"VALIDITY_AUDIT",
				"INDEPENDENT_REVIEW",
				"DIRECTION_LOCK",
			],
		});
		const tmp = await mkdtemp(path.join(tmpdir(), "sif-ingest-term-"));
		try {
			expect(classifyTerminal({ active_state: "DIRECTION_LOCK" })).toBe("honest_success");
			expect(outcomeReady("honest_success")).toBeTrue();
			const report = await ingestLiveRun({
				researchRoot: root,
				ledgerFile: path.join(tmp, "index.json"),
				runsDir: path.join(tmp, "runs"),
			});
			expect(report.mode).toBe("terminal");
			expect(report.outcomeReady).toBeTrue();
			expect(report.ledgerId).toBeTruthy();
			const ledger = await loadLedger(path.join(tmp, "index.json"));
			expect(ledger.records[0]?.step.backend).toBe("live-continuous");
			expect(ledger.records[0]?.step.layer).toBe("L5");
			expect(ledger.records[0]?.kind).toBe("PASS");
		} finally {
			await rm(root, { recursive: true, force: true });
			await rm(tmp, { recursive: true, force: true });
		}
	});

	test("N0-3 HOLD ingest does not require --snapshot and scores thin-frontier as CONTRACT_FAIL", async () => {
		const root = await writeResearchRoot({
			activeState: "N0_AUDIT",
			novelty: "N0-3",
			censusSize: 9,
			kSetSize: 7,
			routeStatus: "INCOMPLETE",
			states: TO_N0_AUDIT,
		});
		const tmp = await mkdtemp(path.join(tmpdir(), "sif-ingest-hold-"));
		try {
			const report = await ingestLiveRun({
				researchRoot: root,
				ledgerFile: path.join(tmp, "index.json"),
				runsDir: path.join(tmp, "runs"),
			});
			expect(report.terminalKind).toBe("hold");
			expect(report.outcomeReady).toBeTrue();
			expect(report.outcomeClass).toBe("failed");
			expect(report.failureClass).toBe("CONTRACT_FAIL");
			expect(report.summary?.thinFrontier).toBeTrue();
			expect(report.summary?.censusSize).toBe(9);
			expect(report.summary?.kSetSize).toBe(7);
			expect(report.efficiency?.yieldEarly).toBeFalse();
			const ledger = await loadLedger(path.join(tmp, "index.json"));
			expect(ledger.records[0]?.kind).toBe("FAIL");
			expect(ledger.records[0]?.failureClass).toBe("CONTRACT_FAIL");
		} finally {
			await rm(root, { recursive: true, force: true });
			await rm(tmp, { recursive: true, force: true });
		}
	});

	test("repeated 120s hub wait/abort is an efficiency process item", async () => {
		const root = await writeResearchRoot({
			activeState: "N0_AUDIT",
			novelty: "N0-3",
			censusSize: 20,
			kSetSize: 8,
			routeStatus: "COMPLETE",
			hubWaits: [
				{ timeoutMs: 120_000, status: "started" },
				{ timeoutMs: 120_000, status: "started" },
			],
			states: TO_N0_AUDIT,
		});
		const tmp = await mkdtemp(path.join(tmpdir(), "sif-ingest-hub-"));
		try {
			const report = await ingestLiveRun({
				researchRoot: root,
				ledgerFile: path.join(tmp, "index.json"),
				runsDir: path.join(tmp, "runs"),
			});
			expect(report.terminalKind).toBe("hold");
			expect(report.failureClass).toBe("EFFICIENCY_REGRESSION");
			expect(report.summary?.shortHubIdle).toBeTrue();
			expect(report.summary?.thinFrontier).toBeFalse();
			expect(report.efficiency?.skipAxes).toEqual([]);
		} finally {
			await rm(root, { recursive: true, force: true });
			await rm(tmp, { recursive: true, force: true });
		}
	});
});

describe("SIF probe", () => {
	test("impact layers pick the cheapest oracles and skip L4–L6", async () => {
		const { probeOraclesForImpact } = await import("./probe");
		expect(probeOraclesForImpact({
			layers: ["L0"],
			nodes: [],
			failures: [],
			ablation: false,
			classes: ["sif"],
			nodesRequired: false,
			unknownFiles: [],
		})).toEqual(["typecheck"]);
		expect(probeOraclesForImpact({
			layers: ["L0", "L1", "L2", "L4", "L5", "L6"],
			nodes: [3],
			failures: [],
			ablation: true,
			classes: ["control-plane"],
			nodesRequired: false,
			unknownFiles: [],
		})).toEqual(["typecheck", "bun-test", "omp-e2e"]);
	});

	test("HIT writes OBSERVE with CES advice and does not append the certify ledger", async () => {
		const { runProbe } = await import("./probe");
		const { loadLedger } = await import("./ledger");
		const before = (await loadLedger()).records.length;
		const root = await mkdtemp(path.join(tmpdir(), "sif-probe-"));
		try {
			const latestFile = path.join(root, "latest.json");
			const logFile = path.join(root, "observations.jsonl");
			const card = await runProbe({
				files: ["extensions/iph.ts"],
				force: true,
				latestFile,
				logFile,
				execOracle: async oracle => {
					if (oracle !== "omp-e2e") return { ok: true, output: `${oracle}=ok\n`, exitCode: 0 };
					return {
						ok: false,
						exitCode: 1,
						output: "Error: mutable artifact rejection omitted the recovery diagnosis\nmust not be frozen\n",
					};
				},
			});
			expect(card.sif).toBe("PROBE");
			expect(card.kind).toBe("OBSERVE");
			expect(card.status).toBe("HIT");
			expect(card.oracle).toBe("omp-e2e");
			expect(card.certify).toBeFalse();
			expect(card.injectIntoResearchSession).toBeFalse();
			expect(card.anchors).toContain("extensions/iph.ts");
			expect(card.reference).toContain("strengthen_validator_gate");
			expect(card.suggestion).toBeTruthy();
			expect(JSON.parse(await readFile(latestFile, "utf8")).status).toBe("HIT");
			expect((await loadLedger()).records.length).toBe(before);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("CLEAR and STALE are tuner signals, not certify PASS/FAIL", async () => {
		const { extraLayersFromProbe, runProbe, staleProbeCard } = await import("./probe");
		const { buildPlan } = await import("./plan");
		const root = await mkdtemp(path.join(tmpdir(), "sif-probe-clear-"));
		try {
			const latestFile = path.join(root, "latest.json");
			const logFile = path.join(root, "observations.jsonl");
			const clear = await runProbe({
				files: ["docs/DEBUG_TUNING_HANDOFF_2026-08-14.md"],
				force: true,
				latestFile,
				logFile,
				execOracle: async () => ({ ok: true, output: "ok\n", exitCode: 0 }),
			});
			expect(clear.status).toBe("CLEAR");
			expect(clear.reference).toContain("full iterate");
			expect(extraLayersFromProbe(clear)).toEqual([]);
			const stale = staleProbeCard(clear, "new-sig", ["extensions/iph.ts"]);
			expect(stale?.status).toBe("STALE");
			expect(stale?.reference).toContain("stale");
			const hit = {
				...clear,
				status: "HIT" as const,
				repairSpec: {
					operator: "strengthen_validator_gate",
					layer: "Verification" as const,
					anchors: ["extensions/iph.ts"],
					regressionSet: ["L0", "L1", "L2"],
					concern: "x",
					evidence: "y",
					suggestion: "z",
				},
			};
			const planned = buildPlan({
				layers: ["L0"],
				nodes: [],
				failures: [],
				ablation: false,
				classes: ["sif"],
				nodesRequired: false,
				unknownFiles: [],
			}, { extraLayers: extraLayersFromProbe(hit) });
			expect(planned.steps.some(step => step.backend === "omp-e2e")).toBeTrue();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("unified session tunes on HIT and promotes CLEAR to framework then certify", async () => {
		const { nextSessionAction, runUnifiedSession } = await import("./session");
		expect(nextSessionAction({ probe: { status: "HIT", deltaSignature: "a" } })).toBe("tune");
		expect(nextSessionAction({ probe: { status: "STALE", deltaSignature: "a" } })).toBe("probe");
		expect(nextSessionAction({
			probe: { status: "CLEAR", deltaSignature: "a" },
			framework: { next_required_action: "RUN_STEP" },
		})).toBe("framework");
		expect(nextSessionAction({
			probe: { status: "CLEAR", deltaSignature: "a" },
			framework: { next_required_action: "REPAIR" },
		})).toBe("replay");
		expect(nextSessionAction({
			probe: { status: "CLEAR", deltaSignature: "a" },
			framework: { next_required_action: "CERTIFY" },
		})).toBe("certify");
		expect(nextSessionAction({
			probe: { status: "CLEAR", deltaSignature: "a" },
			framework: { next_required_action: "DONE" },
			certifiedSignature: "a",
		})).toBe("done");

		const calls: string[] = [];
		const hit = await runUnifiedSession({
			probe: async () => ({
				sif: "PROBE",
				kind: "OBSERVE",
				status: "HIT",
				at: "t",
				oracle: "omp-e2e",
				oraclesRun: ["omp-e2e"],
				deltaSignature: "sig",
				files: ["extensions/iph.ts"],
				certify: false,
				injectIntoResearchSession: false,
				reference: "fix iph.ts",
			}),
			loadFramework: async () => {
				calls.push("load");
				return { next_required_action: "RUN_STEP" } as import("./types").IterationState;
			},
			replay: async () => {
				calls.push("replay");
				return { next_required_action: "RUN_STEP" } as import("./types").IterationState;
			},
			advance: async state => {
				calls.push("advance");
				return state;
			},
			certify: async () => {
				calls.push("certify");
				return { ok: true, action: "DONE", issues: [] };
			},
		});
		expect(hit.map(event => event.action)).toEqual(["tune"]);
		expect(calls).toEqual([]);

		let step = 0;
		const clear = await runUnifiedSession({
			probe: async () => ({
				sif: "PROBE",
				kind: "OBSERVE",
				status: "CLEAR",
				at: "t",
				oracle: "omp-e2e",
				oraclesRun: ["typecheck"],
				deltaSignature: "sig",
				files: ["sif/cli.ts"],
				certify: false,
				injectIntoResearchSession: false,
				reference: "oracles clear",
			}),
			loadFramework: async () => ({
				next_required_action: "RUN_STEP",
				currentStepIndex: step,
				plan: { steps: [{ id: "L0-typecheck+system-matrix" }, { id: "L1-bun-test" }] },
			} as import("./types").IterationState),
			replay: async () => {
				calls.push("replay-clear");
				return { next_required_action: "RUN_STEP" } as import("./types").IterationState;
			},
			advance: async state => {
				calls.push(`advance-${state.plan.steps[state.currentStepIndex]?.id}`);
				step += 1;
				return {
					...state,
					currentStepIndex: step,
					next_required_action: step >= state.plan.steps.length ? "CERTIFY" : "RUN_STEP",
				} as import("./types").IterationState;
			},
			certify: async () => {
				calls.push("certify");
				return { ok: true, action: "DONE", issues: [] };
			},
		});
		expect(clear.some(event => event.action === "framework")).toBeTrue();
		expect(clear.at(-1)?.action).toBe("done");
		expect(calls).toEqual([
			"advance-L0-typecheck+system-matrix",
			"advance-L1-bun-test",
			"certify",
		]);
	});

	test("live snapshot hub-wait becomes a probe HIT without writing ledger FAIL", async () => {
		const { snapshotProbeHit } = await import("./probe");
		const hit = snapshotProbeHit({
			processIssue: "M3 polled specialist with hub wait instead of task lifecycle",
		});
		expect(hit.hit).toBeTrue();
		expect(hit.failureClass).toBe("ELICITATION_REGRESSION");
	});
});

describe("SIF isolation", () => {
	test("committed delta vs main includes sif/", async () => {
		const { committedDelta } = await import("./workspace");
		const files = committedDelta("main");
		expect(files.some(file => file.startsWith("sif/"))).toBeTrue();
		expect(files).toContain("extensions/iph.ts");
	});

	test("the published package files list does not include sif/", async () => {
		const pkg = JSON.parse(await readFile(path.resolve(import.meta.dir, "..", "package.json"), "utf8"));
		expect(pkg.files).not.toContain("sif");
		expect(pkg.scripts.sif).toBe("bun sif/cli.ts");
		expect(pkg.scripts.iterate).toBe("bun sif/cli.ts iterate");
		expect(pkg.scripts["iterate:ingest"]).toBe("bun sif/cli.ts ingest");
		expect(pkg.scripts["iterate:trace"]).toBe("bun sif/cli.ts trace");
		expect(pkg.scripts["iterate:flaws"]).toBe("bun sif/cli.ts flaws");
		expect(pkg.scripts["iterate:probe"]).toBe("bun sif/cli.ts probe");
		expect(pkg.scripts.certify).toBe("bun sif/cli.ts certify");
	});
});

describe("Harbor isolation and HarnessFix RQ3", () => {
	test("L5 trials require a fixture root and unique --run-root paths", async () => {
		const { l5IsolatedTrials } = await import("./isolate");
		expect(() => l5IsolatedTrials({ passK: 2, allocateRoot: index => `/tmp/t${index}` })).toThrow(/SIF_FIXTURE_ROOT/);
		const trials = l5IsolatedTrials({
			fixtureRoot: "/tmp/iph-fixtures",
			passK: 2,
			nodes: [3, 4],
			allocateRoot: index => `/tmp/sif-l5-${index}`,
		});
		expect(trials).toHaveLength(2);
		expect(trials[0]?.runRoot).not.toBe(trials[1]?.runRoot);
		expect(trials[0]?.command).toContain("--run-root");
		expect(trials[0]?.command).toContain("--fixture-root");
		expect(trials[0]?.command).not.toContain("/Users/robinlaw/Downloads/科研harness");
	});

	test("four HarnessFix ablations are strictly weaker than full SIF on hub-wait", async () => {
		const { compareHarnessFixAblations } = await import("./ablation");
		const report = compareHarnessFixAblations();
		expect(report.gatesAreLoadBearing).toBeTrue();
		expect(report.policies.full.operator).toBe("restore_task_lifecycle");
		expect(report.policies["prompt-only"].wouldAccept).toBeFalse();
		expect(report.policies["no-trace"].operator).toBe("delete_suppressing_scaffold");
		expect(report.policies["free-edit"].wouldAccept).toBeTrue();
		expect(report.policies["no-regression"].wouldAccept).toBeTrue();
	});

	test("write-ahead refuses interpolate CES evidence; no evidence is Pass", async () => {
		const { auditWriteAheadRejects, cesComplete, defaultPassWhenNoEvidence } = await import("./ces");
		expect(defaultPassWhenNoEvidence(undefined)).toBe("pass");
		expect(defaultPassWhenNoEvidence("state skip rejected")).toBe("reject");
		expect(cesComplete({ concern: "", evidence: "x", suggestion: "y" }).some(issue => issue.includes("concern"))).toBeTrue();
		const source = await readFile(path.resolve(import.meta.dir, "..", "extensions", "iph.ts"), "utf8");
		const audit = auditWriteAheadRejects(source);
		expect(audit.beforeMutation).toBeGreaterThanOrEqual(6);
		expect(audit.unevidenced).toEqual([]);
	});

	test("iph_advance without iph_status fails observation projection", async () => {
		const { projectionFidelity } = await import("./projection");
		const step = (id: number, name: string, targetState?: string) => ({
			id,
			sourceFile: "a.jsonl",
			role: "M3",
			status: "message" as const,
			effect: name === "iph_advance" ? "state" as const : "read" as const,
			name,
			targetState,
			isLifecycleCompleted: false,
			isMessageOnly: true,
			etcLayer: "Context" as const,
			anchor: "extensions/iph.ts",
		});
		expect(projectionFidelity({
			htir: { schemaVersion: "1.0", steps: [step(1, "iph_advance", "SCOPE_LOCK")] },
			activeState: "BOOT",
		}).ok).toBeFalse();
		expect(projectionFidelity({
			htir: { schemaVersion: "1.0", steps: [step(1, "iph_status"), step(2, "iph_advance", "DIRECTION_LOCK")] },
			activeState: "DIRECTION_LOCK",
			outcomeReady: true,
		}).ok).toBeTrue();
		expect(projectionFidelity({
			htir: { schemaVersion: "1.0", steps: [step(1, "iph_status"), step(2, "iph_advance", "SCOPE_LOCK")] },
			activeState: "DIRECTION_LOCK",
			outcomeReady: true,
		}).ok).toBeFalse();
	});

	test("isolated L5 refuses PROJECT_ROOT when fixture root is unset", async () => {
		const { runBackend } = await import("./backends");
		const result = await runBackend({
			id: "L5-real-models",
			layer: "L5",
			backend: "real-model-nodes",
			oracle: "both",
			realModels: true,
			passK: 2,
		}, { realModels: true, env: { SIF_FIXTURE_ROOT: "" } });
		expect(result.ok).toBeFalse();
		expect(result.output).toContain("refusing to reuse PROJECT_ROOT");
	});

	test("L6 --ablation without a live trace still runs the four-policy gate", async () => {
		const { runBackend } = await import("./backends");
		const result = await runBackend({
			id: "L6-ablation",
			layer: "L6",
			backend: "scaffold-ablation",
			oracle: "process",
			ablation: true,
		}, { ablation: true, env: { SIF_TRACE_ROOT: "" } });
		expect(result.ok).toBeTrue();
		expect(result.output).toContain("gatesAreLoadBearing");
	});
});

describe("Codex historical traces", () => {
	test("forensics session dir resolves to the Raw File jsonl", async () => {
		const { resolveCodexRollout } = await import("./codex");
		const root = await mkdtemp(path.join(tmpdir(), "sif-codex-dir-"));
		try {
			await writeFile(path.join(root, "transcript.md"), [
				"# session",
				"",
				"- Raw File: `/tmp/rollout-example.jsonl`",
				"",
			].join("\n"));
			expect(await resolveCodexRollout(root)).toBe("/tmp/rollout-example.jsonl");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("Codex yield wait is not M3 hub-wait; spawn_agent becomes task", async () => {
		const { compileCodexRollout, scoreCodexTrace } = await import("./codex");
		const htir = await compileCodexRollout(path.resolve(import.meta.dir, "fixtures/codex-sample.jsonl"));
		expect(htir.steps.some(step => step.name === "bash")).toBeTrue();
		expect(htir.steps.some(step => step.name === "wait" && step.op === "yield")).toBeTrue();
		expect(htir.steps.some(step => step.name === "hub")).toBeFalse();
		expect(htir.steps.find(step => step.name === "task")?.specialistAgentId).toBe("review_fail_semantics");
		const report = scoreCodexTrace(htir);
		expect(report.usableAsIphLiveIngest).toBeFalse();
		expect(report.m3HubWait).toBe(0);
		expect(report.spawnedTasks).toBe(1);
		expect(report.kind).toBe("codex-development");
	});

	test("node soft SLA pacing allocates journal vs doctoral budgets", async () => {
		const { computeNodePacing, resolveOutputType } = await import("./efficiency");
		const {
			JOURNAL_DIRECTION_LOCK_BUDGET_MS,
			DOCTORAL_DIRECTION_LOCK_BUDGET_MS,
			JOURNAL_NODE_BUDGET_MS,
		} = await import("../extensions/iph");
		const journal = computeNodePacing({
			outputType: "JOURNAL_ARTICLE",
			nodeDurationsMs: { PRIOR_CLAIM_DRAIN: 500_000, RECENT_FRONTIER: 100_000 },
		});
		expect(journal.totalBudgetMs).toBe(JOURNAL_DIRECTION_LOCK_BUDGET_MS);
		expect(journal.nodeOverruns).toContain(`PRIOR_CLAIM_DRAIN (500000ms > ${JOURNAL_NODE_BUDGET_MS.PRIOR_CLAIM_DRAIN}ms)`);

		const doctoral = computeNodePacing({
			outputType: "DOCTORAL_DISSERTATION",
			nodeDurationsMs: { PRIOR_CLAIM_DRAIN: 500_000 },
		});
		expect(doctoral.totalBudgetMs).toBe(DOCTORAL_DIRECTION_LOCK_BUDGET_MS);
		expect(doctoral.nodeOverruns).toHaveLength(0);
		expect(resolveOutputType("not-a-type")).toBe("JOURNAL_ARTICLE");
		expect(computeNodePacing({ outputType: "bogus" }).totalBudgetMs).toBe(JOURNAL_DIRECTION_LOCK_BUDGET_MS);
	});

	test("isolated run root allocator creates and cleans up tmp dir", async () => {
		const { allocateIsolatedRunRoot, cleanupIsolatedRunRoot } = await import("./isolate");
		const root = await allocateIsolatedRunRoot("cleanup-test");
		expect(root).toContain("sif-cleanup-test-");
		await cleanupIsolatedRunRoot(root);
		expect(await Bun.file(root).exists()).toBeFalse();
	});

	test("isolated L5 backend cleans run roots after a failed trial", async () => {
		const { runBackend } = await import("./backends");
		const fixture = await mkdtemp(path.join(tmpdir(), "sif-l5-fixture-"));
		try {
			const result = await runBackend({
				id: "L5-real-models",
				layer: "L5",
				backend: "real-model-nodes",
				oracle: "both",
				realModels: true,
				passK: 1,
			}, { realModels: true, env: { SIF_FIXTURE_ROOT: fixture } });
			expect(result.ok).toBeFalse();
			expect(result.runRoots?.length).toBe(1);
			for (const root of result.runRoots ?? []) {
				expect(await Bun.file(root).exists()).toBeFalse();
				expect(await Bun.file(path.dirname(root)).exists()).toBeFalse();
			}
		} finally {
			await rm(fixture, { recursive: true, force: true });
		}
	});
});


