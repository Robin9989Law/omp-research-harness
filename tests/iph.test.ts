import { describe, expect, test } from "bun:test";
import { classifyComputeCommand, createBootState, EXIT_STATUS } from "../extensions/iph";

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
