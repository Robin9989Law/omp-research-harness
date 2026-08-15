import type { CertifyResult } from "./certify";
import type { ProbeCard } from "./probe";
import type { IterationState, NextAction } from "./types";

export type SessionAction = "probe" | "tune" | "framework" | "replay" | "certify" | "done" | "wait";

export interface SessionEvent {
	sif: "SESSION";
	action: SessionAction;
	phase: "TUNE" | "FRAMEWORK" | "CERTIFY" | "DONE";
	probe?: ProbeCard | null;
	next_required_action?: NextAction;
	step?: string;
	reference?: string;
	certify?: CertifyResult;
	stop?: IterationState["stop"];
	outcomeClass?: IterationState["outcomeClass"];
}

export function nextSessionAction(input: {
	probe?: Pick<ProbeCard, "status" | "deltaSignature"> | null;
	framework?: Pick<IterationState, "next_required_action"> | null;
	certifiedSignature?: string | null;
	skipProbe?: boolean;
	skipCertify?: boolean;
}): SessionAction {
	if (!input.skipProbe) {
		if (!input.probe) return "probe";
		if (input.probe.status === "HIT") return "tune";
		if (input.probe.status === "STALE") return "probe";
	}
	const next = input.framework?.next_required_action;
	if (next === "REPAIR" || next === "REPLAY") return "replay";
	if (next === "RUN_STEP") return "framework";
	if (next === "CERTIFY") return input.skipCertify ? "done" : "certify";
	if (next === "DONE") {
		if (input.probe && input.certifiedSignature && input.probe.deltaSignature !== input.certifiedSignature) {
			return "framework";
		}
		return "done";
	}
	return "framework";
}

export async function runUnifiedSession(options: {
	watch?: boolean;
	intervalMs?: number;
	skipProbe?: boolean;
	skipCertify?: boolean;
	probe: () => Promise<ProbeCard>;
	loadFramework: () => Promise<IterationState>;
	replay: () => Promise<IterationState>;
	advance: (state: IterationState) => Promise<IterationState>;
	certify: () => Promise<CertifyResult>;
	sleep?: (ms: number) => Promise<void>;
	shouldContinue?: () => boolean;
	emit?: (event: SessionEvent) => void;
}): Promise<SessionEvent[]> {
	const events: SessionEvent[] = [];
	const emit = (event: SessionEvent) => {
		events.push(event);
		options.emit?.(event);
	};
	let certifiedSignature: string | null = null;
	let lastDoneSignature: string | null = null;
	let probe: ProbeCard | undefined;

	do {
		if (!options.skipProbe) {
			probe = await options.probe();
			if (probe.status === "HIT") {
				emit({
					sif: "SESSION",
					action: "tune",
					phase: "TUNE",
					probe,
					reference: probe.reference,
				});
				if (!options.watch) return events;
				await (options.sleep ?? Bun.sleep)(options.intervalMs ?? 8000);
				continue;
			}
			if (probe.status === "STALE") {
				emit({ sif: "SESSION", action: "probe", phase: "TUNE", probe, reference: probe.reference });
				if (!options.watch) return events;
				await (options.sleep ?? Bun.sleep)(options.intervalMs ?? 8000);
				continue;
			}
			emit({
				sif: "SESSION",
				action: "probe",
				phase: "FRAMEWORK",
				probe,
				reference: probe.reference,
			});
		}

		let state = await options.loadFramework();
		let action = nextSessionAction({
			probe,
			framework: state,
			certifiedSignature,
			skipProbe: options.skipProbe,
			skipCertify: options.skipCertify,
		});

		if (action === "replay") {
			state = await options.replay();
			emit({
				sif: "SESSION",
				action: "replay",
				phase: "FRAMEWORK",
				probe,
				next_required_action: state.next_required_action,
				stop: state.stop,
				outcomeClass: state.outcomeClass,
			});
			if (state.next_required_action === "REPAIR") {
				emit({
					sif: "SESSION",
					action: "tune",
					phase: "TUNE",
					probe,
					next_required_action: "REPAIR",
					stop: state.stop,
					reference: state.stop?.repairSpec.suggestion,
				});
				if (!options.watch) return events;
				await (options.sleep ?? Bun.sleep)(options.intervalMs ?? 8000);
				continue;
			}
			action = nextSessionAction({
				probe,
				framework: state,
				certifiedSignature,
				skipProbe: true,
				skipCertify: options.skipCertify,
			});
		}

		while (action === "framework" && state.next_required_action === "RUN_STEP") {
			const stepId = state.plan.steps[state.currentStepIndex]?.id;
			state = await options.advance(state);
			emit({
				sif: "SESSION",
				action: "framework",
				phase: "FRAMEWORK",
				probe,
				step: stepId,
				next_required_action: state.next_required_action,
				stop: state.stop,
				outcomeClass: state.outcomeClass,
			});
			if (state.next_required_action === "REPAIR") {
				emit({
					sif: "SESSION",
					action: "tune",
					phase: "TUNE",
					probe,
					next_required_action: "REPAIR",
					stop: state.stop,
					reference: state.stop?.repairSpec.suggestion,
				});
				break;
			}
			action = nextSessionAction({
				probe,
				framework: state,
				certifiedSignature,
				skipProbe: true,
				skipCertify: options.skipCertify,
			});
		}

		if (state.next_required_action === "REPAIR") {
			if (!options.watch) return events;
			await (options.sleep ?? Bun.sleep)(options.intervalMs ?? 8000);
			continue;
		}

		if (action === "certify") {
			const result = await options.certify();
			if (result.ok) {
				certifiedSignature = probe?.deltaSignature ?? certifiedSignature;
				lastDoneSignature = certifiedSignature;
			}
			emit({
				sif: "SESSION",
				action: result.ok ? "done" : "certify",
				phase: result.ok ? "DONE" : "CERTIFY",
				probe,
				certify: result,
				next_required_action: result.ok ? "DONE" : "CERTIFY",
				reference: result.ok
					? "Unified session certified. Keep watching or stop."
					: result.issues.join("; "),
			});
			if (!result.ok && !options.watch) return events;
		} else if (action === "done") {
			certifiedSignature = probe?.deltaSignature ?? certifiedSignature;
			if (lastDoneSignature !== certifiedSignature) {
				lastDoneSignature = certifiedSignature ?? null;
				emit({
					sif: "SESSION",
					action: "done",
					phase: "DONE",
					probe,
					next_required_action: "DONE",
					reference: "Already certified for this delta.",
				});
			}
		}

		if (!options.watch) return events;
		if (options.shouldContinue && !options.shouldContinue()) return events;
		await (options.sleep ?? Bun.sleep)(options.intervalMs ?? 8000);
	} while (options.watch && (!options.shouldContinue || options.shouldContinue()));

	return events;
}
