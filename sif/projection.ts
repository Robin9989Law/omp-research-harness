import type { Htir, TraceStep } from "./types";

export interface ProjectionReport {
	ok: boolean;
	projected?: string;
	authoritative?: string;
	observedBeforeAct: boolean;
	issue?: string;
}

export function lastAdvanceTarget(steps: TraceStep[]): string | undefined {
	for (let index = steps.length - 1; index >= 0; index -= 1) {
		const step = steps[index];
		if (step?.name === "iph_advance" && step.targetState) return step.targetState;
	}
	return undefined;
}

export function observationBeforeAct(steps: TraceStep[]): boolean {
	for (let index = 0; index < steps.length; index += 1) {
		if (steps[index]?.name !== "iph_advance") continue;
		const window = steps.slice(Math.max(0, index - 8), index);
		if (!window.some(step => step.name === "iph_status")) return false;
	}
	return true;
}

/**
 * HarnessBridge observation projection: iph_status must precede act, and a
 * successful terminal's last advance target must match workflow_state.active_state.
 */
export function projectionFidelity(options: {
	htir: Htir;
	activeState?: string;
	outcomeReady?: boolean;
}): ProjectionReport {
	const authoritative = options.activeState ?? options.htir.activeState;
	const projected = lastAdvanceTarget(options.htir.steps);
	const observedBeforeAct = observationBeforeAct(options.htir.steps);
	if (options.htir.steps.some(step => step.name === "iph_advance") && !observedBeforeAct) {
		return {
			ok: false,
			projected,
			authoritative,
			observedBeforeAct,
			issue: "iph_advance without a recent iph_status projection of active state",
		};
	}
	if (options.outcomeReady && projected && authoritative && projected !== authoritative) {
		return {
			ok: false,
			projected,
			authoritative,
			observedBeforeAct,
			issue: `last iph_advance projected ${projected} but workflow_state.active_state is ${authoritative}`,
		};
	}
	return { ok: true, projected, authoritative, observedBeforeAct };
}
