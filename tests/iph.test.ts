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
	recordSubagentLifecycle,
	resolveSkillDir,
	restoreProtectedSnapshot,
	runtimeReviewerIdentity,
	sealRuntimeReview,
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
			expect(sealedState.validity_level).toBe("V3");
			expect(sealedAudit.reviewer_agent_id).toBe("omp-task-reviewer-42");
			expect(sealedAudit.reviewer_thread_id).toBe("omp-session-99");
			expect(sealedState.independent_audit).toEqual(sealedAudit);
			expect(sealedState.review_artifact_sha256).toMatch(/^[0-9a-f]{64}$/);

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
			await writeFile(path.join(root, "independent_audit.json"), "audit-original\n");
			await writeFile(path.join(root, "review_artifacts", "review-1.json"), "review-original\n");
			const snapshot = await captureProtectedSnapshot(root, true);
			await writeFile(path.join(root, "workflow_state.json"), "state-tampered\n");
			await rm(path.join(root, "independent_audit.json"));
			await writeFile(path.join(root, "review_artifacts", "review-2.json"), "new-tamper\n");
			const restored = await restoreProtectedSnapshot(snapshot);
			expect(restored).toContain("workflow_state.json");
			expect(restored).toContain("independent_audit.json");
			expect(await readFile(path.join(root, "workflow_state.json"), "utf8")).toBe("state-original\n");
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
});
