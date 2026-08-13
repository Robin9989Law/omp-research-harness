import { describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
	captureProtectedSnapshot,
	classifyComputeCommand,
	clearRuntimeRegistryForTests,
	createBootState,
	EXIT_STATUS,
	executableText,
	findResearchRoot,
	inspectStopLock,
	mutableArtifactConflicts,
	recordSubagentLifecycle,
	requiredSpecialistForTarget,
	resolveSkillDir,
	restoreProtectedSnapshot,
	runtimeReviewerIdentity,
	sanitizeSpecialistTaskInput,
	sealRuntimeReview,
	shouldContinueSessionStop,
	transitionPlanForState,
	validateLifecycleState,
	verifySkillLock,
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
	test("requires strong specialists only at scientific judgment gates", () => {
		expect(requiredSpecialistForTarget("SCOPE_LOCK")).toBeUndefined();
		expect(requiredSpecialistForTarget("RECENT_FRONTIER")).toBe("frontier-auditor");
		expect(requiredSpecialistForTarget("L1_FREEZE")).toBe("layer-adjudicator");
		expect(requiredSpecialistForTarget("SYNTHESIZE_COLLISION")).toBe("atomic-claim-extractor");
		expect(requiredSpecialistForTarget("OUTPUT_CLAIM_BIND")).toBe("collision-synthesizer");
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
