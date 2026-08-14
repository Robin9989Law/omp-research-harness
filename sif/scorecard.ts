import { SCORECARD_SCHEMA, type AgentRole, type Htir, type RoleLoop, type RoleScorecard, type TraceStep } from "./types";

const SPECIALIST_ROLES: Record<string, AgentRole> = {
	"frontier-auditor": "frontier",
	frontier: "frontier",
	"layer-adjudicator": "layer",
	layer: "layer",
	"atomic-claim-extractor": "atomic",
	atomic: "atomic",
	"collision-synthesizer": "collision",
	collision: "collision",
	"iph-reviewer": "review",
	review: "review",
	"event-flow-manager": "event",
	event: "event",
};

const INVALID_TOOLS = new Set(["ipc_call"]);
const HUB_WAIT_OPS = new Set(["wait", "jobs"]);

export function roleOfStep(step: TraceStep): AgentRole {
	const mapped = SPECIALIST_ROLES[step.role];
	if (mapped) return mapped;
	if (step.role === "M3" || step.role === "default") return "M3";
	if (/frontier/i.test(step.role)) return "frontier";
	if (/layer-adjudicator|layer/i.test(step.role)) return "layer";
	if (/atomic/i.test(step.role)) return "atomic";
	if (/collision/i.test(step.role)) return "collision";
	if (/reviewer|review/i.test(step.role)) return "review";
	if (/event-flow|event/i.test(step.role)) return "event";
	return "M3";
}

function names(steps: TraceStep[]): string[] {
	return steps.map(step => step.name).filter((name): name is string => Boolean(name));
}

function inferDisposition(htir: Htir, explicit?: string): string | undefined {
	if (explicit) return explicit;
	const fromSteps = [...htir.steps].reverse().find(step => step.disposition === "ACCEPTED" || step.disposition === "OVERRIDDEN");
	return fromSteps?.disposition;
}

function advancesHaveStatusPlan(steps: TraceStep[]): boolean {
	const coordinator = steps.filter(step => roleOfStep(step) === "M3");
	const advances = coordinator.filter(step => step.name === "iph_advance");
	if (advances.length === 0) {
		const toolNames = names(coordinator);
		return toolNames.length === 0 || (toolNames.includes("iph_status") && toolNames.includes("iph_transition_plan"));
	}
	let window: TraceStep[] = [];
	for (const step of coordinator) {
		if (step.name === "iph_advance") {
			const prior = names(window);
			if (!prior.includes("iph_status") || !prior.includes("iph_transition_plan")) return false;
			window = [];
			continue;
		}
		window.push(step);
	}
	return true;
}

export function m3PolledWithHub(steps: TraceStep[]): boolean {
	return steps.some(step => {
		if (roleOfStep(step) !== "M3" || step.name !== "hub") return false;
		return !step.op || HUB_WAIT_OPS.has(step.op);
	});
}

function loopFor(role: AgentRole, steps: TraceStep[], all: TraceStep[]): RoleLoop {
	const toolNames = names(steps);
	const foundProblem = steps.some(step => step.status === "failure" || step.name === "iph_validate" || step.disposition === "OVERRIDDEN")
		|| all.some(step => step.disposition === "OVERRIDDEN" || step.disposition === "ACCEPTED");
	const optimizedTask = !steps.some(step => INVALID_TOOLS.has(step.name ?? ""))
		&& (role !== "M3" || (advancesHaveStatusPlan(all) && !m3PolledWithHub(all)));
	const finishedEfficiently = role === "event"
		? !toolNames.includes("iph_advance")
		: role === "review"
			? toolNames.includes("iph_review") || steps.some(step => step.isLifecycleCompleted)
			: toolNames.includes("iph_advance") || steps.some(step => step.isLifecycleCompleted);
	return { role, foundProblem, optimizedTask, finishedEfficiently };
}

export function scoreHtir(htir: Htir, options?: { specialist?: string; disposition?: string }): RoleScorecard {
	const byRole = new Map<AgentRole, TraceStep[]>();
	byRole.set("M3", []);
	for (const step of htir.steps) {
		const role = roleOfStep(step);
		const bucket = byRole.get(role) ?? [];
		bucket.push(step);
		byRole.set(role, bucket);
	}

	const disposition = inferDisposition(htir, options?.disposition);
	const loops: RoleLoop[] = [];
	const m3 = loopFor("M3", byRole.get("M3") ?? [], htir.steps);
	if (options?.specialist) {
		const closed = disposition === "ACCEPTED" || disposition === "OVERRIDDEN";
		m3.foundProblem = closed || m3.foundProblem;
		if (!closed) {
			m3.foundProblem = false;
			m3.finishedEfficiently = false;
		}
	}
	loops.push(m3);
	for (const [agent, role] of Object.entries(SPECIALIST_ROLES)) {
		if ((byRole.get(role)?.length ?? 0) > 0 || options?.specialist === agent) {
			if (loops.some(loop => loop.role === role)) continue;
			loops.push(loopFor(role, byRole.get(role) ?? [], htir.steps));
		}
	}

	const invalidToolCalls = htir.steps.filter(step => INVALID_TOOLS.has(step.name ?? "") || (step.status === "failure" && step.effect === "unknown")).length;
	return {
		schema: SCORECARD_SCHEMA,
		loops,
		invalidToolCalls,
		informationBudgetHeld: !htir.steps.some(step => step.name === "glob" && step.effect === "read") || htir.steps.some(step => step.name === "iph_transition_plan"),
		scaffoldThickness: htir.steps.filter(step => step.name === "iph_status" || step.name === "iph_transition_plan").length,
	};
}

export function elicitationRegression(scorecard: RoleScorecard, options?: { specialist?: string; inProgress?: boolean; htir?: Htir }): string | undefined {
	const m3 = scorecard.loops.find(loop => loop.role === "M3");
	if (options?.htir && m3PolledWithHub(options.htir.steps)) {
		return "M3 polled specialist with hub wait instead of task lifecycle";
	}
	if (!m3?.optimizedTask) return "M3 did not keep the task minimal (status → plan → one act; no hub wait / ipc_call)";
	if (options?.specialist) {
		if (!m3.foundProblem) return "specialist edge closed without ACCEPTED/OVERRIDDEN disposition";
		if (!options.inProgress) {
			const specialistRole = SPECIALIST_ROLES[options.specialist];
			const specialist = specialistRole ? scorecard.loops.find(loop => loop.role === specialistRole) : undefined;
			if (specialist && !specialist.finishedEfficiently) {
				return `${options.specialist} did not finish through lifecycle completion`;
			}
		}
	}
	if (scorecard.invalidToolCalls > 0) return "invalid or invented tool calls present";
	if (!options?.inProgress && !m3.finishedEfficiently) return "M3 did not close the edge";
	return undefined;
}

export function outcomeClassFor(options: {
	outcomeReady: boolean;
	scorecard: RoleScorecard;
	specialist?: string;
	inProgress?: boolean;
	htir?: Htir;
}): "autonomous_verified_success" | "unverified_success" | "failed" {
	if (!options.outcomeReady) return "failed";
	return elicitationRegression(options.scorecard, {
		specialist: options.specialist,
		inProgress: options.inProgress,
		htir: options.htir,
	})
		? "unverified_success"
		: "autonomous_verified_success";
}

const ROLE_AGENT: Record<AgentRole, string | undefined> = {
	M3: undefined,
	frontier: "frontier-auditor",
	layer: "layer-adjudicator",
	atomic: "atomic-claim-extractor",
	collision: "collision-synthesizer",
	review: "iph-reviewer",
	event: "event-flow-manager",
};

export function inferSpecialist(htir: Htir): string | undefined {
	const fromAdvance = [...htir.steps].reverse().find(step => step.specialistAgentId)?.specialistAgentId;
	if (fromAdvance) {
		if (/frontier/i.test(fromAdvance)) return "frontier-auditor";
		if (/layer/i.test(fromAdvance)) return "layer-adjudicator";
		if (/atomic/i.test(fromAdvance)) return "atomic-claim-extractor";
		if (/collision/i.test(fromAdvance)) return "collision-synthesizer";
		if (/review/i.test(fromAdvance)) return "iph-reviewer";
	}
	const fromRole = htir.steps.find(step => roleOfStep(step) !== "M3");
	return fromRole ? ROLE_AGENT[roleOfStep(fromRole)] : undefined;
}
