import {
	POSITIVE_STATE_SEQUENCE,
	nodeBudgetTable,
	directionLockBudgetMs,
	type ResearchOutputType,
} from "../extensions/iph";
import type { FailureClass } from "./types";
import type { LiveDiagnostics } from "./diagnostics";

export interface NodePacingReport {
	outputType: ResearchOutputType;
	totalBudgetMs: number;
	nodeBudgets: Record<string, number>;
	nodeOverruns: string[];
}

export interface EfficiencyReport {
	skipAxes: string[];
	yieldEarly: boolean;
	overrun: boolean;
	elapsedMs?: number;
	budgetMs?: number;
	pendingAtExit: boolean;
	unboundedSearch: boolean;
	nodePacing?: NodePacingReport;
	issue?: string;
}

export function resolveOutputType(value: unknown): ResearchOutputType {
	return value === "DOCTORAL_DISSERTATION" ? "DOCTORAL_DISSERTATION" : "JOURNAL_ARTICLE";
}

export function computeNodePacing(options: {
	outputType?: unknown;
	nodeDurationsMs?: Record<string, number>;
}): NodePacingReport {
	const outputType = resolveOutputType(options.outputType);
	const totalBudgetMs = directionLockBudgetMs(outputType);
	const nodeBudgets = nodeBudgetTable(outputType);
	const nodeOverruns: string[] = [];

	if (options.nodeDurationsMs) {
		for (const [node, duration] of Object.entries(options.nodeDurationsMs)) {
			const budget = nodeBudgets[node];
			if (budget != null && duration > budget) {
				nodeOverruns.push(`${node} (${duration}ms > ${budget}ms)`);
			}
		}
	}

	return {
		outputType,
		totalBudgetMs,
		nodeBudgets,
		nodeOverruns,
	};
}

export function skipAxes(loggedStates: string[]): string[] {
	const skips: string[] = [];
	let previous = -1;
	for (const state of loggedStates) {
		const index = (POSITIVE_STATE_SEQUENCE as readonly string[]).indexOf(state);
		if (index < 0) continue;
		if (previous >= 0 && index > previous + 1) {
			skips.push(`${POSITIVE_STATE_SEQUENCE[previous]}->${state} skipped ${POSITIVE_STATE_SEQUENCE.slice(previous + 1, index).join(",")}`);
		}
		previous = index;
	}
	return skips;
}

export function efficiencyReport(options: {
	loggedStates: string[];
	terminal: boolean;
	stopped: boolean;
	snapshot: boolean;
	startedAt?: string;
	budgetMs?: number;
	endedAt?: string;
	diagnostics?: LiveDiagnostics;
	outputType?: ResearchOutputType;
	nodeDurationsMs?: Record<string, number>;
}): EfficiencyReport {
	const skips = skipAxes(options.loggedStates);
	const lastPending = options.diagnostics?.pendingToolCalls.at(-1);
	const pendingAtExit = !options.snapshot && options.stopped && (options.diagnostics?.pendingToolCalls.length ?? 0) > 0;
	const unbounded = (options.diagnostics?.unboundedSearch.length ?? 0) > 0;
	const yieldEarly = !options.snapshot && options.stopped && !options.terminal;
	let elapsedMs: number | undefined;
	if (options.startedAt) {
		const start = Date.parse(options.startedAt);
		const end = Date.parse(options.endedAt ?? "") || Date.now();
		if (Number.isFinite(start) && Number.isFinite(end) && end >= start) elapsedMs = end - start;
	}
	const dwellDurations = Object.fromEntries(
		(options.diagnostics?.nodeDwell ?? []).map(item => [item.state, item.ms]),
	);
	const pacing = options.outputType || options.nodeDurationsMs || options.diagnostics?.nodeDwell?.length
		? computeNodePacing({
			outputType: options.outputType,
			nodeDurationsMs: options.nodeDurationsMs ?? (Object.keys(dwellDurations).length > 0 ? dwellDurations : undefined),
		})
		: undefined;
	const budget = options.budgetMs ?? pacing?.totalBudgetMs;
	const overrun = budget != null && elapsedMs != null && elapsedMs > budget;
	let issue: string | undefined;
	if (skips.length > 0) issue = `skip-axes: ${skips.join("; ")}`;
	else if (unbounded) issue = `unbounded-search: ${options.diagnostics?.unboundedSearch[0]}`;
	else if (pendingAtExit && lastPending?.toolName === "hub") {
		issue = "pending hub wait at session exit; use task lifecycle instead of polling";
	}
	else if (pendingAtExit) issue = `pending ${lastPending?.toolName ?? "tool"} at session exit`;
	else if (yieldEarly) issue = "yield-early: session stopped before DIRECTION_LOCK, an honest negative, or a legal N0-3 hold";
	return {
		skipAxes: skips,
		yieldEarly,
		overrun,
		elapsedMs,
		budgetMs: budget,
		pendingAtExit,
		unboundedSearch: unbounded,
		nodePacing: pacing,
		issue,
	};
}

export function efficiencyFailureClass(report: EfficiencyReport): FailureClass | undefined {
	if (report.skipAxes.length > 0 || report.yieldEarly || report.pendingAtExit || report.unboundedSearch) {
		return "EFFICIENCY_REGRESSION";
	}
	return undefined;
}
