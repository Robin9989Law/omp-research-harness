import {
	shouldContinueSessionStop,
	specialistFailureInputIssue,
	transitionTargetIssue,
} from "../extensions/iph";

export interface RecoveryInjectionReport {
	ok: boolean;
	cases: Array<"STOP" | "BLOCKED" | "rollback">;
	issues: string[];
}

export function runRecoveryInjection(): RecoveryInjectionReport {
	const issues: string[] = [];
	if (shouldContinueSessionStop({ exitCode: 2 }, { active_state: "BLOCKED" }, true)) {
		issues.push("STOP-locked BLOCKED auto-continued");
	}
	if (shouldContinueSessionStop({ exitCode: 1 }, { active_state: "BLOCKED" }, false)) {
		issues.push("committed BLOCKED auto-continued");
	}
	if (shouldContinueSessionStop({ exitCode: 1 }, { active_state: "SCOPE_LOCK" }, true)) {
		issues.push("STOP lock did not halt a repairable INVALID");
	}
	if (!shouldContinueSessionStop({ exitCode: 1 }, { active_state: "SCOPE_LOCK" }, false)) {
		issues.push("repairable INVALID without STOP lock did not continue once");
	}
	if (!transitionTargetIssue({ active_state: "COMPLETE" }, "BLOCKED")) {
		issues.push("COMPLETE was allowed to enter BLOCKED");
	}

	const failState = { active_state: "RECENT_FRONTIER" } as never;
	const validFail = {
		to: "RECENT_FRONTIER",
		specialistAgentId: "FrontierAuditNode04",
		specialistDisposition: "ACCEPTED" as const,
		specialistRationale: "The exact frontier rule is violated by the recorded query ledger.",
		specialistRule: "R-FRONTIER-11",
		specialistEvidence: "No executed forward-citation route is recorded in frontier_coverage.json.",
		requiredRemediation: "Run and record the bounded forward-citation traversal, then request a fresh audit.",
		nextAction: "Run and record the bounded forward-citation traversal, then request a fresh audit.",
		gates: [] as string[],
		artifacts: [] as string[],
		stateArtifacts: [] as string[],
	};
	if (specialistFailureInputIssue(failState, validFail)) {
		issues.push("same-gate specialist FAIL contract rejected a valid closure");
	}
	if (!specialistFailureInputIssue(failState, { ...validFail, to: "BLOCKED" })?.includes("must remain")) {
		issues.push("specialist FAIL was allowed to jump to BLOCKED");
	}
	if (!specialistFailureInputIssue(failState, { ...validFail, gates: ["literature_registry_valid=false"] })?.includes("cannot mutate")) {
		issues.push("same-gate FAIL was allowed to mutate gates (rollback contract)");
	}

	return {
		ok: issues.length === 0,
		cases: ["STOP", "BLOCKED", "rollback"],
		issues,
	};
}
