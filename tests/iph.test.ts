import { describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
	captureProtectedSnapshot,
	auditSystemTopology,
	classifyComputeCommand,
	clearRuntimeRegistryForTests,
	createBootState,
	EXIT_STATUS,
	executableText,
	eventFlowSnapshot,
	findResearchRoot,
	inspectStopLock,
	inspectSpecialistCompletion,
	mutableArtifactConflicts,
	nodeBriefing,
	recordSubagentLifecycle,
	POSITIVE_STATE_SEQUENCE,
	requiredNextAction,
	requiredSpecialistForTarget,
	resolveSkillDir,
	restoreProtectedSnapshot,
	runtimeReviewerIdentity,
	sanitizeSpecialistTaskInput,
	sealRuntimeReview,
	shouldContinueSessionStop,
	specialistDispositionIssue,
	specialistRuntimeModelEvidence,
	transitionPlanForState,
	transitionArtifactScopeIssue,
	transitionGateIssue,
	transitionTargetIssue,
	transitionContributionIssue,
	nextActionIssue,
	validateLifecycleState,
	verifySkillLock,
	waitForSpecialistCompletion,
} from "../extensions/iph";

describe("exit status translation", () => {
	test("preserves all authoritative exit meanings", () => {
		expect(EXIT_STATUS).toEqual({
			0: "READY",
			1: "INVALID",
			2: "BLOCKED",
			3: "MIGRATION_REQUIRED",
		});
	});
});

describe("session-stop control", () => {
	test("never auto-continues a STOP-locked or committed BLOCKED workflow", () => {
		expect(shouldContinueSessionStop({ exitCode: 2 }, { active_state: "BLOCKED" }, true)).toBeFalse();
		expect(shouldContinueSessionStop({ exitCode: 2 }, { active_state: "BLOCKED" }, false)).toBeFalse();
		expect(shouldContinueSessionStop({ exitCode: 1 }, { active_state: "BLOCKED" }, false)).toBeFalse();
	});

	test("continues once for a repairable INVALID workflow without a STOP lock", () => {
		expect(shouldContinueSessionStop({ exitCode: 1 }, { active_state: "SCOPE_LOCK" }, false)).toBeTrue();
		expect(shouldContinueSessionStop({ exitCode: 0 }, { active_state: "SCOPE_LOCK" }, false)).toBeFalse();
	});
});

describe("read-only STOP visibility", () => {
	test("reports physical lock presence and parsed details without validating", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "iph-stop-visibility-"));
		try {
			expect(await inspectStopLock(root)).toEqual({ active: false, details: null });
			await writeFile(
				path.join(root, ".workflow_stop.lock"),
				JSON.stringify({ exit_code: 2, effective_state: "PRIOR_CLAIM_DRAIN" }),
			);
			expect(await inspectStopLock(root)).toEqual({
				active: true,
				details: { exit_code: 2, effective_state: "PRIOR_CLAIM_DRAIN" },
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("M3 control-plane routing", () => {
	test("briefs critical nodes with题面、requirements, examples and completion proof before action", () => {
		const plan = transitionPlanForState({ active_state: "LITERATURE_REGISTER" } as never);
		expect(plan).toBeDefined();
		const briefing = nodeBriefing(
			"LITERATURE_REGISTER",
			{ artifacts: { literature_registry: "near_neighbor_registry.json", url_ledger: "near_neighbor_url_ledger.v2.csv" } },
			plan!,
			"/authoritative/iph",
		);
		expect(briefing.instruction).toContain("READ");
		expect(briefing.readBeforeAct).toContain("near_neighbor_registry.json");
		expect(briefing.readBeforeAct).toContain("/authoritative/iph/templates.md");
		expect(briefing.examples.valid).toContain("NOT_QUALIFIED");
		expect(briefing.examples.invalid).toContain("atomic/full-text claim");
		expect(briefing.completionProof.join(" ")).toContain("formally completed");
	});

	test("binds gate assignments to their completion state before mutation", () => {
		expect(transitionGateIssue("L2_TRIAGE", ["k_set_selected=true"])).toBeUndefined();
		expect(transitionGateIssue("L2_TRIAGE", ["l2_frozen=true"])).toContain("missing target gate");
		expect(transitionGateIssue("L2_TRIAGE", ["k_set_selected=true", "l2_frozen=true"])).toContain("belongs to LAYER_DECISION");
		expect(transitionGateIssue("LAYER_DECISION", ["l2_frozen=true", "architecture_frozen=true"])).toBeUndefined();
		expect(transitionGateIssue("N0_AUDIT", ["n0_4_locked=true"], "N0-4C")).toBeUndefined();
		expect(transitionGateIssue("N0_AUDIT", ["n0_4_locked=false"], "N0-2")).toBeUndefined();
		expect(transitionGateIssue("N0_AUDIT", ["n0_4_locked=true"], "N0-2")).toContain("missing target gate");
		expect(transitionGateIssue("N0_AUDIT", [], undefined)).toContain("requires noveltyLevel");
	});

	test("rejects skipped state targets before any mutation", () => {
		expect(transitionTargetIssue({ active_state: "BOOT" }, "SCOPE_LOCK")).toBeUndefined();
		expect(transitionTargetIssue({ active_state: "BOOT" }, "RECENT_FRONTIER")).toContain("state skip rejected");
		expect(transitionTargetIssue({ active_state: "N0_AUDIT", novelty_level: "N0-2" }, "CLAIM_FREEZE")).toContain("no positive transition");
		expect(transitionTargetIssue({ active_state: "L2_TRIAGE" }, "BLOCKED")).toBeUndefined();
	});

	test("requires the exact immutable artifact scope for every positive edge", () => {
		expect(transitionArtifactScopeIssue(
			{ active_state: "BOOT" },
			"SCOPE_LOCK",
			["scope_lock.md", "hierarchy_status.md"],
		)).toBeUndefined();
		expect(transitionArtifactScopeIssue(
			{ active_state: "BOOT" },
			"SCOPE_LOCK",
			["scope_lock.md", "hierarchy_status.md", "l1-card.md"],
		)).toContain("extra: l1-card.md");
		expect(transitionArtifactScopeIssue(
			{ active_state: "BOOT" },
			"SCOPE_LOCK",
			["scope_lock.md"],
		)).toContain("missing: hierarchy_status.md");
		expect(transitionArtifactScopeIssue(
			{ active_state: "RECENT_FRONTIER" },
			"LITERATURE_REGISTER",
			["literature_registry.json"],
		)).toContain("expected exactly: (none)");
		expect(transitionArtifactScopeIssue(
			{ active_state: "BOOT" },
			"SCOPE_LOCK",
			["scope_lock.md", "scope_lock.md", "hierarchy_status.md"],
		)).toContain("extra: scope_lock.md");
	});

	test("makes contribution and next-action parameters constructible before mutation", () => {
		expect(transitionContributionIssue("L2_TRIAGE", "JOURNAL_ARTICLE", "NONE", undefined)).toBeUndefined();
		expect(transitionContributionIssue("L2_TRIAGE", "JOURNAL_ARTICLE", "NONE", "M")).toContain("L1/L2");
		expect(transitionContributionIssue("K_FULLTEXT", "JOURNAL_ARTICLE", "NONE", undefined)).toBeUndefined();
		expect(transitionContributionIssue("K_FULLTEXT", "DOCTORAL_DISSERTATION", "NONE", undefined)).toContain("A|B|C");
		expect(transitionContributionIssue("K_FULLTEXT", "DOCTORAL_DISSERTATION", "NONE", "A")).toBeUndefined();
		expect(requiredNextAction("L2_TRIAGE")).toBe("Complete L2_TRIAGE and advance exactly once to LAYER_DECISION.");
		expect(nextActionIssue("L2_TRIAGE", "Complete L2_TRIAGE and advance exactly once to LAYER_DECISION.")).toBeUndefined();
		expect(nextActionIssue("L2_TRIAGE", "Run LAYER_DECISION after the K set is selected.")).toContain("must equal");
		expect(nextActionIssue("COMPLETE", "Workflow complete; do not advance further.")).toBeUndefined();
	});

	test("requires an explicit, reasoned disposition without treating specialist completion as authority", () => {
		expect(specialistDispositionIssue("frontier-auditor", undefined, undefined, undefined)).toContain("specialistAgentId");
		expect(specialistDispositionIssue("frontier-auditor", "FrontierAudit", undefined, undefined)).toContain("specialistDisposition");
		expect(specialistDispositionIssue("frontier-auditor", "FrontierAudit", "OVERRIDDEN", undefined)).toContain("specialistRationale");
		expect(specialistDispositionIssue(
			"frontier-auditor",
			"FrontierAudit",
			"OVERRIDDEN",
			"The distinct-URL objection has no contract basis; the validator accepts role-correct reuse.",
		)).toBeUndefined();
		expect(specialistDispositionIssue(
			"frontier-auditor", "FrontierAudit", "ACCEPTED",
			"The evidence is complete; runtime model was deepseek-v4-flash.",
		)).toContain("must not assert runtime model identity");
		expect(specialistDispositionIssue(undefined, undefined, undefined, undefined)).toBeUndefined();
	});

	test("reads specialist model identity from its authenticated session rather than free text", async () => {
		clearRuntimeRegistryForTests();
		const sessionFile = "/tmp/iph-specialist-model-evidence.jsonl";
		await Bun.write(sessionFile, [
			JSON.stringify({ type: "session" }),
			JSON.stringify({ type: "model_change", model: "openai-codex/gpt-5.6-sol", resolvedModelIsFallback: false }),
		].join("\n"));
		recordSubagentLifecycle({
			id: "LayerModelEvidence",
			agent: "layer-adjudicator",
			status: "completed",
			sessionFile,
		}, { researchRoot: "/tmp/model-evidence-root", target: "L2_TRIAGE", agents: new Set(["layer-adjudicator"]) });
		expect(await specialistRuntimeModelEvidence(
			"LayerModelEvidence", "layer-adjudicator", "/tmp/model-evidence-root", "L2_TRIAGE",
		)).toMatchObject({ model: "openai-codex/gpt-5.6-sol", resolvedModelIsFallback: false });
	});

	test("accepts only formally completed specialists bound to the exact root and target", () => {
		clearRuntimeRegistryForTests();
		const binding = {
			researchRoot: "/tmp/research-a",
			target: "RECENT_FRONTIER",
			agents: new Set(["frontier-auditor"]),
		};
		recordSubagentLifecycle({
			id: "FrontierAudit",
			agent: "frontier-auditor",
			status: "started",
			sessionFile: "/tmp/frontier-a.jsonl",
			parentToolCallId: "task-call-1",
		}, binding);
		expect(inspectSpecialistCompletion(
			"FrontierAudit", "frontier-auditor", "/tmp/research-a", "RECENT_FRONTIER",
		).status).toBe("started");
		recordSubagentLifecycle({
			id: "FrontierAudit",
			agent: "frontier-auditor",
			status: "completed",
			sessionFile: "/tmp/frontier-a.jsonl",
			parentToolCallId: "task-call-1",
		}, binding);
		expect(inspectSpecialistCompletion(
			"FrontierAudit", "frontier-auditor", "/tmp/research-a", "RECENT_FRONTIER",
		).completed).toBeTrue();
		expect(inspectSpecialistCompletion(
			"FrontierAudit", "frontier-auditor", "/tmp/research-b", "RECENT_FRONTIER",
		).status).toBe("binding_mismatch");
		expect(inspectSpecialistCompletion(
			"FrontierAudit", "frontier-auditor", "/tmp/research-a", "LITERATURE_REGISTER",
		).status).toBe("binding_mismatch");
	});

	test("waits through the PASS-message versus formal-completion race", async () => {
		clearRuntimeRegistryForTests();
		const binding = {
			researchRoot: "/tmp/research-race",
			target: "RECENT_FRONTIER",
			agents: new Set(["frontier-auditor"]),
		};
		const lifecycle = (status: "started" | "completed") => recordSubagentLifecycle({
			id: "FrontierRace",
			agent: "frontier-auditor",
			status,
			sessionFile: "/tmp/frontier-race.jsonl",
			parentToolCallId: "task-race",
		}, binding);
		lifecycle("started");
		setTimeout(() => lifecycle("completed"), 25);
		const result = await waitForSpecialistCompletion(
			"FrontierRace",
			"frontier-auditor",
			"/tmp/research-race",
			"RECENT_FRONTIER",
			undefined,
			500,
		);
		expect(result.completed).toBeTrue();
		expect(result.status).toBe("completed");
	});

	test("keeps lifecycle terminal states monotonic under duplicate and out-of-order events", () => {
		clearRuntimeRegistryForTests();
		const binding = {
			researchRoot: "/tmp/research-events",
			target: "RECENT_FRONTIER",
			agents: new Set(["frontier-auditor"]),
		};
		const event = (id: string, status: "started" | "completed" | "failed" | "aborted", sessionFile: string) => ({
			id,
			agent: "frontier-auditor",
			status,
			sessionFile,
			parentToolCallId: "task-events",
		});

		recordSubagentLifecycle(event("Ordered", "started", "/tmp/ordered.jsonl"), binding);
		recordSubagentLifecycle(event("Ordered", "completed", "/tmp/ordered.jsonl"), binding);
		recordSubagentLifecycle(event("Ordered", "started", "/tmp/ordered.jsonl"), binding);
		recordSubagentLifecycle(event("Ordered", "failed", "/tmp/ordered.jsonl"), binding);
		expect(inspectSpecialistCompletion(
			"Ordered", "frontier-auditor", "/tmp/research-events", "RECENT_FRONTIER",
		).status).toBe("completed");

		recordSubagentLifecycle(event("OutOfOrder", "completed", "/tmp/out-of-order.jsonl"), binding);
		recordSubagentLifecycle(event("OutOfOrder", "started", "/tmp/out-of-order.jsonl"));
		expect(inspectSpecialistCompletion(
			"OutOfOrder", "frontier-auditor", "/tmp/research-events", "RECENT_FRONTIER",
		).completed).toBeTrue();

		recordSubagentLifecycle(event("Original", "started", "/tmp/collision.jsonl"), binding);
		recordSubagentLifecycle(event("Impostor", "completed", "/tmp/collision.jsonl"), binding);
		expect(inspectSpecialistCompletion(
			"Original", "frontier-auditor", "/tmp/research-events", "RECENT_FRONTIER",
		).status).toBe("started");
		expect(inspectSpecialistCompletion(
			"Impostor", "frontier-auditor", "/tmp/research-events", "RECENT_FRONTIER",
		).status).toBe("not_observed");
		const mixedBinding = { ...binding, agents: new Set(["frontier-auditor", "scout", "event-flow-manager"]) };
		recordSubagentLifecycle({ ...event("OptionalRead", "completed", "/tmp/optional.jsonl"), agent: "scout" }, mixedBinding);
		recordSubagentLifecycle({ ...event("EventManager", "completed", "/tmp/manager.jsonl"), agent: "event-flow-manager" }, mixedBinding);
		const snapshot = eventFlowSnapshot("/tmp/research-events", "RECENT_FRONTIER", "frontier-auditor");
		expect(snapshot.counts.currentCompleted).toBe(1);
		expect(snapshot.counts.currentStarted).toBe(0);
		expect(snapshot.counts.conflicts).toBe(2);
		expect(snapshot.counts.optional).toBe(1);
		expect(snapshot.tasks.some(task => task.id === "EventManager")).toBeFalse();
		expect(snapshot.recommendation).toBe("RECONCILE_CONFLICT");
		expect(snapshot.stateChangeJustified).toBeFalse();
	});

	test("compresses a high-volume mixed event stream without confusing optional or stale work", () => {
		clearRuntimeRegistryForTests();
		const researchRoot = "/tmp/research-event-storm";
		const required = { researchRoot, target: "L2_TRIAGE", agents: new Set(["layer-adjudicator"]) };
		const optional = { researchRoot, target: "L2_TRIAGE", agents: new Set(["scout"]) };
		const stale = { researchRoot, target: "L1_FREEZE", agents: new Set(["scout"]) };
		recordSubagentLifecycle({
			id: "RequiredLayer",
			agent: "layer-adjudicator",
			status: "completed",
			sessionFile: "/tmp/storm-required.jsonl",
			parentToolCallId: "storm",
		}, required);
		for (let index = 0; index < 1_000; index += 1) {
			recordSubagentLifecycle({
				id: `Optional-${index}`,
				agent: "scout",
				status: "completed",
				sessionFile: `/tmp/storm-optional-${index}.jsonl`,
				parentToolCallId: "storm",
			}, optional);
		}
		for (let index = 0; index < 100; index += 1) {
			recordSubagentLifecycle({
				id: `Stale-${index}`,
				agent: "scout",
				status: "failed",
				sessionFile: `/tmp/storm-stale-${index}.jsonl`,
				parentToolCallId: "storm-old",
			}, stale);
		}
		const snapshot = eventFlowSnapshot(researchRoot, "L2_TRIAGE", "layer-adjudicator");
		expect(snapshot.counts.total).toBe(1_101);
		expect(snapshot.counts.currentCompleted).toBe(1);
		expect(snapshot.counts.optional).toBe(1_000);
		expect(snapshot.counts.stale).toBe(100);
		expect(snapshot.counts.conflicts).toBe(0);
		expect(snapshot.recommendation).toBe("VERIFY_ARTIFACTS_AND_RECORD_DISPOSITION");
		expect(snapshot.stateChangeJustified).toBeTrue();
	});

	test("covers the complete positive state topology with no contract gaps", () => {
		expect(POSITIVE_STATE_SEQUENCE).toHaveLength(23);
		expect(POSITIVE_STATE_SEQUENCE[0]).toBe("BOOT");
		expect(POSITIVE_STATE_SEQUENCE.at(-1)).toBe("COMPLETE");
		expect(auditSystemTopology()).toEqual([]);
	});

	test("requires independent specialist peers only at scientific judgment gates", () => {
		expect(requiredSpecialistForTarget("SCOPE_LOCK")).toBeUndefined();
		expect(requiredSpecialistForTarget("RECENT_FRONTIER")).toBe("frontier-auditor");
		expect(requiredSpecialistForTarget("L1_FREEZE")).toBe("layer-adjudicator");
		expect(requiredSpecialistForTarget("SYNTHESIZE_COLLISION")).toBe("atomic-claim-extractor");
		expect(requiredSpecialistForTarget("OUTPUT_CLAIM_BIND")).toBe("collision-synthesizer");
		expect(requiredSpecialistForTarget("DIRECTION_LOCK")).toBe("iph-reviewer");
		expect(requiredSpecialistForTarget("FINAL_LOCK")).toBe("iph-reviewer");
	});

	test("returns deterministic navigation through the full positive path", () => {
		expect(transitionPlanForState({ active_state: "LAYER_DECISION" })?.target).toBe("K_FULLTEXT");
		expect(transitionPlanForState({ active_state: "DIRECTION_LOCK" })?.target).toBe("COMPUTE");
		expect(transitionPlanForState({ active_state: "FINAL_LOCK" })?.target).toBe("COMPLETE");
		expect(transitionPlanForState({ active_state: "N0_AUDIT", novelty_level: "N0-2" })).toBeUndefined();
		expect(transitionPlanForState({ active_state: "N0_AUDIT", novelty_level: "N0-4C" })?.target).toBe("CLAIM_FREEZE");
	});

	test("rejects freezing mutable pointer artifacts", () => {
		expect(mutableArtifactConflicts(
			["near_neighbor_registry.json", "scope_lock.md"],
			["literature_registry=near_neighbor_registry.json", "scope_lock=scope_lock.md"],
		)).toEqual(["literature_registry=near_neighbor_registry.json"]);
	});

	test("removes caller schemas only from scientific specialist tasks", () => {
		expect(sanitizeSpecialistTaskInput({
			context: "frontier gate",
			tasks: [
				{
					name: "FrontierAudit",
					agent: "frontier-auditor",
					task: "write the contracted frontier artifacts",
					outputSchema: "{malformed",
					schemaMode: "strict",
				},
				{ name: "Scout", agent: "scout", task: "read only", outputSchema: { type: "object" } },
			],
		})).toEqual({
			context: "frontier gate",
			tasks: [
				{
					name: "FrontierAudit",
					agent: "frontier-auditor",
					task: "write the contracted frontier artifacts",
				},
				{ name: "Scout", agent: "scout", task: "read only", outputSchema: { type: "object" } },
			],
		});
		expect(sanitizeSpecialistTaskInput({
			context: "already minimal",
			tasks: [{ name: "FrontierAudit", agent: "frontier-auditor", task: "audit" }],
		})).toBeUndefined();
	});
});

describe("BOOT state", () => {
	test("creates a journal contract without advancing", () => {
		const state = createBootState({
			workflowId: "topic-1",
			outputType: "JOURNAL_ARTICLE",
			claimProfile: "ALGORITHM",
			currentYear: 2026,
		});
		expect(state.schema_version).toBe("3.0");
		expect(state.active_state).toBe("BOOT");
		expect(state.resume_state).toBe("BOOT");
		expect(state.contribution_contract).toBe("ONE_MAIN_M");
		expect(state.active_contribution).toBe("NONE");
		expect(state.gates.compute_authorized).toBeFalse();
		expect(state.recent_window).toEqual({
			start_year: 2024,
			end_year: 2026,
			status: "INCOMPLETE",
			snapshot_mode: "NOT_SET",
		});
	});

	test("creates a doctoral contribution contract", () => {
		const state = createBootState({
			workflowId: "doctoral-topic",
			outputType: "DOCTORAL_DISSERTATION",
			claimProfile: "THEORY",
			currentYear: 2026,
		});
		expect(state.contribution_contract).toBe("THREE_ORGANIC_A_B_C");
	});
});

describe("compute preflight", () => {
	test("inspects only executable bash and eval fields", () => {
		const safeBash = executableText("bash", {
			command: "git status --short",
			intent: "train and simulate the candidate model",
			description: "fit the experimental baseline",
		});
		const safeEval = executableText("eval", {
			code: "1 + 1",
			title: "simulate and fit the model",
		});

		expect(safeBash).toBe("git status --short");
		expect(safeEval).toBe("1 + 1");
		expect(classifyComputeCommand(safeBash)).toBeUndefined();
		expect(classifyComputeCommand(safeEval)).toBeUndefined();
		expect(classifyComputeCommand(executableText("bash", { command: "make run_experiment" }))).toContain(
			"experimental",
		);
	});

	test("blocks research scripts", () => {
		expect(classifyComputeCommand("python3 experiments/train_model.py --seed 1")).toContain("script");
	});

	test("blocks inline ML computation", () => {
		expect(classifyComputeCommand("python3 -c 'import numpy as np; print(np.mean([1,2]))'")).toContain(
			"numerical",
		);
	});

	test("blocks experiment verbs", () => {
		expect(classifyComputeCommand("make run_experiment")).toContain("experimental");
	});

	test("allows toy arithmetic and iph maintenance", () => {
		expect(classifyComputeCommand("python3 -c 'print(1+1)'")).toBeUndefined();
		expect(classifyComputeCommand("python3 /skill/scripts/iph.py validate --root . --state workflow_state.json")).toBeUndefined();
		expect(classifyComputeCommand("python3 /skill/scripts/validate_all.py --root . --state workflow_state.json")).toBeUndefined();
	});

	test("allows non-compute research operations", () => {
		expect(classifyComputeCommand("git status --short")).toBeUndefined();
		expect(classifyComputeCommand("curl https://api.crossref.org/works/10.1/example")).toBeUndefined();
	});
});

describe("runtime-bound reviewer provenance", () => {
	test("accepts only an active iph-reviewer lifecycle record for the exact session", () => {
		clearRuntimeRegistryForTests();
		recordSubagentLifecycle({
			id: "task-review-7",
			agent: "iph-reviewer",
			status: "started",
			sessionFile: "/tmp/reviewer-7.jsonl",
		});
		expect(runtimeReviewerIdentity("/tmp/reviewer-7.jsonl", "thread-real")).toEqual({
			reviewerAgentId: "task-review-7",
			reviewerThreadId: "thread-real",
			sessionFile: "/tmp/reviewer-7.jsonl",
		});
		expect(runtimeReviewerIdentity("/tmp/another-session.jsonl", "thread-real")).toBeUndefined();
		recordSubagentLifecycle({
			id: "task-author-1",
			agent: "atomic-claim-extractor",
			status: "started",
			sessionFile: "/tmp/author.jsonl",
		});
		expect(runtimeReviewerIdentity("/tmp/author.jsonl", "thread-spoofed")).toBeUndefined();
	});

	test("seals actual runtime IDs and lets the authoritative validator detect later tamper", async () => {
		const skillDir = resolveSkillDir();
		expect(skillDir).toBeTruthy();
		const root = await mkdtemp(path.join(tmpdir(), "iph-runtime-review-"));
		try {
			await cp(path.join(skillDir!, "tests", "fixtures", "minimal-valid-v3"), root, { recursive: true });
			const statePath = path.join(root, "workflow_state.json");
			const state = JSON.parse(await readFile(statePath, "utf8"));
			state.active_state = "INDEPENDENT_REVIEW";
			state.resume_state = "INDEPENDENT_REVIEW";
			state.validity_level = "V2";
			state.independent_audit = {};
			delete state.review_artifact_sha256;
			await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);

			const auditPath = path.join(root, "independent_audit.json");
			const audit = JSON.parse(await readFile(auditPath, "utf8"));
			audit.reviewer_agent_id = "forged-by-caller";
			audit.reviewer_thread_id = "forged-thread";
			audit.review_answers = {
				data_authenticity: "compute_evidence.json identifies the synthetic source and manuscript.md uses the same provenance wording.",
				baseline_execution: "test_outputs/online_chronology_pass.json contains non-empty comparator executions matching baseline_budget.json.",
				claim_strength: "claim_inventory.json and manuscript.md use algorithm-profile wording without unsupported theory claims.",
				falsification_attempt: "checks/check_online_chronology.py was rerun against protocol_contract.json and did not expose chronology leakage.",
			};
			await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`);

			const result = await sealRuntimeReview(
				root,
				"PASS",
				undefined,
				false,
				{
					reviewerAgentId: "omp-task-reviewer-42",
					reviewerThreadId: "omp-session-99",
					sessionFile: "/tmp/reviewer-42.jsonl",
				},
			);
			expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
			const sealedState = JSON.parse(await readFile(statePath, "utf8"));
			const sealedAudit = JSON.parse(await readFile(auditPath, "utf8"));
			const rebuiltLifecycle = JSON.parse(await readFile(path.join(root, "lifecycle_state.json"), "utf8"));
			expect(sealedState.validity_level).toBe("V3");
			expect(sealedAudit.reviewer_agent_id).toBe("omp-task-reviewer-42");
			expect(sealedAudit.reviewer_thread_id).toBe("omp-session-99");
			expect(sealedState.independent_audit).toEqual(sealedAudit);
			expect(sealedState.review_artifact_sha256).toMatch(/^[0-9a-f]{64}$/);
			expect(validateLifecycleState(rebuiltLifecycle, "E3")).toEqual([]);

			sealedAudit.review_answers.data_authenticity += " tampered";
			await writeFile(auditPath, `${JSON.stringify(sealedAudit, null, 2)}\n`);
			const validator = Bun.spawn(
				[
					process.env.IPH_PYTHON || "python3",
					path.join(skillDir!, "scripts", "iph.py"),
					"validate",
					"--root", root,
					"--state", statePath,
				],
				{ cwd: root, stdout: "pipe", stderr: "pipe", env: { ...process.env, IPH_NO_LOCK: "1" } },
			);
			const output = await new Response(validator.stdout).text();
			expect(await validator.exited).not.toBe(0);
			expect(output).toContain("REVIEW_ARTIFACT_TAMPERED");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("protected artifact rollback", () => {
	test("restores edits, deletions, and newly created review files from arbitrary tools", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "iph-protected-"));
		try {
			await mkdir(path.join(root, "review_artifacts"));
			await writeFile(path.join(root, "workflow_state.json"), "state-original\n");
			await writeFile(path.join(root, "lifecycle_state.json"), "lifecycle-original\n");
			await writeFile(path.join(root, "independent_audit.json"), "audit-original\n");
			await writeFile(path.join(root, "review_artifacts", "review-1.json"), "review-original\n");
			const snapshot = await captureProtectedSnapshot(root, true);
			await writeFile(path.join(root, "workflow_state.json"), "state-tampered\n");
			await writeFile(path.join(root, "lifecycle_state.json"), "lifecycle-tampered\n");
			await rm(path.join(root, "independent_audit.json"));
			await writeFile(path.join(root, "review_artifacts", "review-2.json"), "new-tamper\n");
			const restored = await restoreProtectedSnapshot(snapshot);
			expect(restored).toContain("workflow_state.json");
			expect(restored).toContain("lifecycle_state.json");
			expect(restored).toContain("independent_audit.json");
			expect(await readFile(path.join(root, "workflow_state.json"), "utf8")).toBe("state-original\n");
			expect(await readFile(path.join(root, "lifecycle_state.json"), "utf8")).toBe("lifecycle-original\n");
			expect(await readFile(path.join(root, "independent_audit.json"), "utf8")).toBe("audit-original\n");
			expect(await readFile(path.join(root, "review_artifacts", "review-1.json"), "utf8")).toBe("review-original\n");
			await expect(readFile(path.join(root, "review_artifacts", "review-2.json"), "utf8")).rejects.toThrow();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("allows a reviewer to append a regular new epoch artifact without changing old evidence", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "iph-review-append-"));
		try {
			await mkdir(path.join(root, "review_artifacts"));
			await writeFile(path.join(root, "workflow_state.json"), "state-original\n");
			await writeFile(path.join(root, "review_artifacts", "epoch-1.json"), "old-review\n");
			const snapshot = await captureProtectedSnapshot(root, true, true);
			await writeFile(path.join(root, "review_artifacts", "epoch-2.json"), "new-review\n");
			expect(await restoreProtectedSnapshot(snapshot)).toEqual([]);
			expect(await readFile(path.join(root, "review_artifacts", "epoch-2.json"), "utf8")).toBe("new-review\n");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("also protects a configured audit pointer outside the default review directory", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "iph-configured-audit-"));
		try {
			await mkdir(path.join(root, "audits"));
			await writeFile(path.join(root, "workflow_state.json"), "state-original\n");
			await writeFile(path.join(root, "audits", "current.json"), "configured-original\n");
			const snapshot = await captureProtectedSnapshot(root, true, false, "audits/current.json");
			await writeFile(path.join(root, "audits", "current.json"), "configured-tamper\n");
			expect(await restoreProtectedSnapshot(snapshot)).toContain("audits/current.json");
			expect(await readFile(path.join(root, "audits", "current.json"), "utf8")).toBe("configured-original\n");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("restores a decision-log artifact changed by an arbitrary tool", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "iph-frozen-decision-artifact-"));
		try {
			await writeFile(path.join(root, "scope_lock.md"), "scope-original\n");
			await writeFile(path.join(root, "lifecycle_state.json"), "lifecycle-original\n");
			await writeFile(path.join(root, "workflow_state.json"), `${JSON.stringify({
				decision_log: [{ artifacts: [{ path: "scope_lock.md", sha256: "0".repeat(64) }] }],
			})}\n`);
			const snapshot = await captureProtectedSnapshot(root, false);
			await writeFile(path.join(root, "scope_lock.md"), "scope-tampered\n");
			expect(await restoreProtectedSnapshot(snapshot)).toContain("scope_lock.md");
			expect(await readFile(path.join(root, "scope_lock.md"), "utf8")).toBe("scope-original\n");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("research root and lifecycle contract", () => {
	test("discovers the nearest workflow root from a nested working directory", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "iph-root-discovery-"));
		try {
			const nested = path.join(root, "analysis", "figures");
			await mkdir(nested, { recursive: true });
			expect(findResearchRoot(nested)).toBeUndefined();
			await writeFile(path.join(root, "workflow_state.json"), "{}\n");
			expect(findResearchRoot(nested)).toBe(root);
			await writeFile(path.join(root, "analysis", "workflow_state.json"), "{}\n");
			expect(findResearchRoot(nested)).toBe(path.join(root, "analysis"));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("rejects lifecycle pointer drift and extra schema fields", () => {
		const canonical = {
			schema_version: "1.0",
			active_stage: "E3",
			stage_pointers: {
				E0: "workflow_state.json#output_type",
				E1: null,
				E2: "workflow_state.json",
				E3: "workflow_state.json",
				E4: "workflow_state.json#compute_stage",
				E5: null,
				E6: null,
			},
		};
		expect(validateLifecycleState(canonical, "E3")).toEqual([]);
		expect(validateLifecycleState({ ...canonical, active_stage: "E2" }, "E3")).toContain(
			"active_stage drift: expected E3, found E2",
		);
		expect(validateLifecycleState({ ...canonical, unexpected: true }, "E3")).toContain(
			"top-level keys do not match the lifecycle schema",
		);
		expect(
			validateLifecycleState({
				...canonical,
				stage_pointers: { ...canonical.stage_pointers, E4: "other.json" },
			}),
		).toContain('stage_pointers.E4 must equal "workflow_state.json#compute_stage"');
	});
});

describe("authoritative skill lock", () => {
	test("accepts the pinned checkout and blocks a content-tampered copy", async () => {
		const skillDir = resolveSkillDir();
		expect(skillDir).toBeTruthy();
		expect((await verifySkillLock(skillDir!)).ok).toBeTrue();
		const copyRoot = await mkdtemp(path.join(tmpdir(), "iph-lock-copy-"));
		try {
			const lock = JSON.parse(await readFile(path.resolve(import.meta.dir, "..", "config", "iph-lock.json"), "utf8"));
			for (const relative of Object.keys(lock.files)) {
				await mkdir(path.dirname(path.join(copyRoot, relative)), { recursive: true });
				await cp(path.join(skillDir!, relative), path.join(copyRoot, relative));
			}
			expect((await verifySkillLock(copyRoot)).ok).toBeTrue();
			await writeFile(path.join(copyRoot, "scripts", "iph.py"), "# tampered\n", { flag: "a" });
			const tampered = await verifySkillLock(copyRoot);
			expect(tampered.ok).toBeFalse();
			expect(tampered.reason).toContain("locked file hash mismatch: scripts/iph.py");
		} finally {
			await rm(copyRoot, { recursive: true, force: true });
		}
	});
});
