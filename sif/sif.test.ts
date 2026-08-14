import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { efficiencyReport, skipAxes } from "./efficiency";
import { regressionAwareAccept, heldOutRegressed } from "./accept";
import { compileHtir, compileTraceLinks } from "./htir";
import { consolidateFlaws } from "./flaws";
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
	});

	test("HTIR control-flow links mark retry and data produces", () => {
		const links = compileTraceLinks([
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
				effect: "state",
				name: "iph_advance",
				targetState: "SCOPE_LOCK",
				isLifecycleCompleted: false,
				isMessageOnly: true,
				etcLayer: "Verification",
				anchor: "extensions/iph.ts",
			},
			{
				id: 3,
				sourceFile: "a.jsonl",
				role: "M3",
				status: "message",
				effect: "state",
				name: "iph_advance",
				targetState: "SCOPE_LOCK",
				isLifecycleCompleted: false,
				isMessageOnly: true,
				etcLayer: "Verification",
				anchor: "extensions/iph.ts",
			},
		]);
		expect(links.some(link => link.kind === "data" && link.relation === "produces")).toBeTrue();
		expect(links.some(link => link.kind === "control" && link.relation === "retry")).toBeTrue();
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
	});
});

describe("live ingest", () => {
	async function writeResearchRoot(options: { activeState: string; novelty?: string; states?: string[] }): Promise<string> {
		const root = await mkdtemp(path.join(tmpdir(), "sif-live-"));
		const sessions = path.join(root, ".harness-sessions");
		await mkdir(sessions, { recursive: true });
		await writeFile(path.join(root, "workflow_state.json"), `${JSON.stringify({
			active_state: options.activeState,
			novelty_level: options.novelty ?? "N0-3",
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
		}, null, 2)}\n`);
		await writeFile(path.join(sessions, "session.jsonl"), `${JSON.stringify({
			type: "message",
			message: {
				role: "assistant",
				content: [
					{ type: "toolCall", name: "iph_status", arguments: {} },
					{ type: "toolCall", name: "iph_transition_plan", arguments: {} },
					{ type: "toolCall", name: "iph_advance", arguments: { to: options.activeState } },
				],
			},
		})}\n`);
		return root;
	}

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
});

describe("SIF isolation", () => {
	test("the published package files list does not include sif/", async () => {
		const pkg = JSON.parse(await readFile(path.resolve(import.meta.dir, "..", "package.json"), "utf8"));
		expect(pkg.files).not.toContain("sif");
		expect(pkg.scripts.iterate).toBe("bun sif/cli.ts iterate");
		expect(pkg.scripts["iterate:ingest"]).toBe("bun sif/cli.ts ingest");
		expect(pkg.scripts["iterate:trace"]).toBe("bun sif/cli.ts trace");
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
});


