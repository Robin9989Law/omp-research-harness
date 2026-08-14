import { POSITIVE_STATE_SEQUENCE } from "../extensions/iph";

export type TerminalKind = "in_progress" | "honest_success" | "honest_negative" | "blocked" | "stop";

export interface WorkflowSnapshot {
	active_state?: string;
	novelty_level?: string;
	output_type?: string;
	next_required_action?: string;
	decision_log?: Array<{ state?: string; action?: string; at?: string }>;
}

const SUCCESS_STATES = new Set(["DIRECTION_LOCK", "COMPLETE", "FINAL_LOCK"]);
const N0_INDEX = (POSITIVE_STATE_SEQUENCE as readonly string[]).indexOf("N0_AUDIT");

export function classifyTerminal(workflow: WorkflowSnapshot, options?: { stopLock?: boolean }): TerminalKind {
	if (options?.stopLock) return "stop";
	const active = workflow.active_state ?? "";
	if (active === "BLOCKED") return "blocked";
	if (SUCCESS_STATES.has(active)) return "honest_success";
	const novelty = workflow.novelty_level ?? "";
	const activeIndex = (POSITIVE_STATE_SEQUENCE as readonly string[]).indexOf(active);
	if ((novelty === "N0-1" || novelty === "N0-2") && activeIndex >= N0_INDEX) return "honest_negative";
	return "in_progress";
}

export function outcomeReady(kind: TerminalKind): boolean {
	return kind === "honest_success" || kind === "honest_negative" || kind === "blocked";
}

export function loggedStates(workflow: WorkflowSnapshot): string[] {
	if (!Array.isArray(workflow.decision_log)) return [];
	return workflow.decision_log
		.map(entry => entry.state)
		.filter((state): state is string => typeof state === "string" && state.length > 0);
}

export function lastDecisionAt(workflow: WorkflowSnapshot): string | undefined {
	const entries = Array.isArray(workflow.decision_log) ? workflow.decision_log : [];
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		if (typeof entries[index]?.at === "string") return entries[index]?.at;
	}
	return undefined;
}

export function dispositionFromLog(workflow: WorkflowSnapshot): string | undefined {
	const entries = Array.isArray(workflow.decision_log) ? workflow.decision_log : [];
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const action = entries[index]?.action ?? "";
		const match = /disposition=(ACCEPTED|OVERRIDDEN)/.exec(action);
		if (match) return match[1];
	}
	return undefined;
}
