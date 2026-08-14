import { projectionFidelity, type ProjectionReport } from "./projection";
import { roleOfStep } from "./scorecard";
import type { Htir, TraceStep } from "./types";
import type { WorkflowSnapshot } from "./outcome";

export interface NodeDwell {
	state: string;
	ms: number;
	budgetMs?: number;
	overrun: boolean;
}

export interface LiveDiagnostics {
	toolCounts: Record<string, number>;
	hubOps: Record<string, number>;
	m3HubWait: number;
	duplicateAdvances: Array<{ to: string; count: number }>;
	unboundedSearch: string[];
	pendingToolCalls: NonNullable<Htir["pendingToolCalls"]>;
	sessionExits: NonNullable<Htir["sessionExits"]>;
	nodeDwell: NodeDwell[];
	nextRequiredAction?: string;
	projection?: ProjectionReport;
}

function increment(map: Record<string, number>, key: string): void {
	map[key] = (map[key] ?? 0) + 1;
}

export function duplicateAdvances(steps: TraceStep[]): Array<{ to: string; count: number }> {
	const counts = new Map<string, number>();
	let previous: string | undefined;
	for (const step of steps) {
		if (step.name !== "iph_advance" || !step.targetState) continue;
		if (step.targetState === previous) counts.set(step.targetState, (counts.get(step.targetState) ?? 1) + 1);
		else if (!counts.has(step.targetState)) counts.set(step.targetState, 1);
		previous = step.targetState;
	}
	return [...counts.entries()]
		.filter(([, count]) => count > 1)
		.map(([to, count]) => ({ to, count }));
}

export function unboundedSearch(steps: TraceStep[]): string[] {
	const hits: string[] = [];
	for (const step of steps) {
		if (step.name !== "bash" || !step.detail) continue;
		if (/(?:grep|find|ripgrep|rg)\b/.test(step.detail) && /(?:\s|^)\/(?:\s|$|2>)/.test(step.detail)) {
			hits.push(step.detail);
		}
	}
	return hits;
}

export function nodeDwell(
	workflow: WorkflowSnapshot,
	options?: { nodeBudgetMs?: Record<string, number>; endedAt?: string },
): NodeDwell[] {
	const entries = Array.isArray(workflow.decision_log) ? workflow.decision_log : [];
	const dwells: NodeDwell[] = [];
	for (let index = 0; index < entries.length; index += 1) {
		const current = entries[index];
		if (!current?.state || !current.at) continue;
		const nextAt = entries[index + 1]?.at ?? options?.endedAt;
		if (!nextAt) continue;
		const ms = Date.parse(nextAt) - Date.parse(current.at);
		if (!Number.isFinite(ms) || ms < 0) continue;
		const budgetMs = options?.nodeBudgetMs?.[current.state];
		dwells.push({
			state: current.state,
			ms,
			budgetMs,
			overrun: budgetMs != null && ms > budgetMs,
		});
	}
	return dwells;
}

export function liveDiagnostics(htir: Htir, workflow?: WorkflowSnapshot, harnessRun?: Record<string, unknown>): LiveDiagnostics {
	const toolCounts: Record<string, number> = {};
	const hubOps: Record<string, number> = {};
	let m3HubWait = 0;
	for (const step of htir.steps) {
		if (step.name) increment(toolCounts, step.name);
		if (step.name === "hub") increment(hubOps, step.op ?? "unspecified");
		if (roleOfStep(step) === "M3" && step.name === "hub" && (!step.op || step.op === "wait" || step.op === "jobs")) m3HubWait += 1;
	}
	const nodeBudgetMs = harnessRun?.node_budget_ms && typeof harnessRun.node_budget_ms === "object"
		? harnessRun.node_budget_ms as Record<string, number>
		: undefined;
	return {
		toolCounts,
		hubOps,
		m3HubWait,
		duplicateAdvances: duplicateAdvances(htir.steps),
		unboundedSearch: unboundedSearch(htir.steps),
		pendingToolCalls: htir.pendingToolCalls ?? [],
		sessionExits: htir.sessionExits ?? [],
		nodeDwell: workflow ? nodeDwell(workflow, { nodeBudgetMs }) : [],
		nextRequiredAction: workflow?.next_required_action,
		projection: projectionFidelity({
			htir,
			activeState: workflow?.active_state,
		}),
	};
}
