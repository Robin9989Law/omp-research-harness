import { cesComplete } from "./ces";
import { regressionAwareAccept, type AcceptDecision } from "./accept";
import { attributeFailure } from "./repair";
import type { LiveDiagnostics } from "./diagnostics";
import type { EfficiencyReport } from "./efficiency";
import type { RepairSpec, RoleScorecard, TraceStep } from "./types";
import { SCORECARD_SCHEMA } from "./types";

export interface AblationLadder {
	h0OutcomeWithoutProcess: boolean;
	h1InvalidTools: boolean;
	h2SkipOrPendingOrHubWait: boolean;
	h3InformationBudgetBroken: boolean;
	informationBudgetHeld: boolean;
}

export function ablationLadder(options: {
	outcomeReady: boolean;
	scorecard: RoleScorecard;
	efficiency?: EfficiencyReport;
	diagnostics?: LiveDiagnostics;
	processIssue?: string;
}): AblationLadder {
	const h1 = options.scorecard.invalidToolCalls > 0;
	const h2 = Boolean(
		options.efficiency?.skipAxes.length
		|| options.efficiency?.pendingAtExit
		|| (options.diagnostics?.m3HubWait ?? 0) > 0,
	);
	const h3 = options.scorecard.informationBudgetHeld === false || Boolean(options.efficiency?.unboundedSearch);
	return {
		h0OutcomeWithoutProcess: options.outcomeReady && Boolean(options.processIssue),
		h1InvalidTools: h1,
		h2SkipOrPendingOrHubWait: h2,
		h3InformationBudgetBroken: h3,
		informationBudgetHeld: options.scorecard.informationBudgetHeld && !h3,
	};
}

export type AblationPolicy = "full" | "prompt-only" | "no-trace" | "free-edit" | "no-regression";

export interface PolicyOutcome {
	policy: AblationPolicy;
	wouldAccept: boolean;
	operator: string;
	reasons: string[];
}

export interface HarnessFixAblation {
	informationBudgetHeld: boolean;
	policies: Record<AblationPolicy, PolicyOutcome>;
	gatesAreLoadBearing: boolean;
}

const HUB_WAIT_STEP: TraceStep = {
	id: 1,
	sourceFile: "a.jsonl",
	role: "M3",
	status: "message",
	effect: "unknown",
	name: "hub",
	op: "wait",
	isLifecycleCompleted: false,
	isMessageOnly: false,
	etcLayer: "Observability",
	anchor: "SYSTEM.md",
};

function isPromptScoped(spec: RepairSpec): boolean {
	return spec.anchors.every(anchor => anchor.endsWith(".md") || anchor === "SYSTEM.md")
		&& (spec.layer === "Context" || spec.operator === "delete_suppressing_scaffold");
}

export function compareHarnessFixAblations(options?: {
	spec?: RepairSpec;
	noTraceSpec?: RepairSpec;
	accept?: AcceptDecision;
	heldOutStillPass?: boolean;
	informationBudgetHeld?: boolean;
}): HarnessFixAblation {
	const spec = options?.spec ?? attributeFailure({
		failureClass: "ELICITATION_REGRESSION",
		message: "M3 polled specialist with hub wait instead of task lifecycle",
		steps: [HUB_WAIT_STEP],
	});
	const noTraceSpec = options?.noTraceSpec ?? attributeFailure({
		failureClass: "ELICITATION_REGRESSION",
		message: "role closed an edge without a process scorecard",
	});
	const heldOutStillPass = options?.heldOutStillPass ?? true;
	const accept = options?.accept ?? regressionAwareAccept({
		after: { schema: SCORECARD_SCHEMA, loops: [], invalidToolCalls: 0, informationBudgetHeld: true, scaffoldThickness: 0 },
		targetGone: true,
		heldOutStillPass,
	});
	const ces = cesComplete(spec);
	const fullAccept = accept.accept && ces.length === 0;
	const promptOnly = isPromptScoped(spec) && fullAccept;
	const policies: Record<AblationPolicy, PolicyOutcome> = {
		full: {
			policy: "full",
			wouldAccept: fullAccept,
			operator: spec.operator,
			reasons: [...accept.reasons, ...ces],
		},
		"prompt-only": {
			policy: "prompt-only",
			wouldAccept: promptOnly,
			operator: promptOnly ? spec.operator : "none",
			reasons: promptOnly ? [] : ["prompt-only cannot apply a non-prompt scoped operator"],
		},
		"no-trace": {
			policy: "no-trace",
			wouldAccept: noTraceSpec.operator === spec.operator && fullAccept,
			operator: noTraceSpec.operator,
			reasons: noTraceSpec.operator === spec.operator ? [] : [`no-trace picked ${noTraceSpec.operator} instead of ${spec.operator}`],
		},
		"free-edit": {
			policy: "free-edit",
			wouldAccept: true,
			operator: "unbounded-edit",
			reasons: ["free-form edits ignore scoped operators and CES"],
		},
		"no-regression": {
			policy: "no-regression",
			wouldAccept: true,
			operator: spec.operator,
			reasons: heldOutStillPass ? ["skips held-out reuseKey check"] : ["would accept despite held-out FAIL"],
		},
	};
	const weaker = !policies["prompt-only"].wouldAccept
		&& policies["no-trace"].operator !== policies.full.operator
		&& policies["free-edit"].wouldAccept
		&& policies["no-regression"].wouldAccept;
	return {
		informationBudgetHeld: options?.informationBudgetHeld ?? true,
		policies,
		gatesAreLoadBearing: weaker && policies.full.operator.length > 0,
	};
}

export function ablationReport(options: {
	outcomeReady: boolean;
	scorecard: RoleScorecard;
	efficiency?: EfficiencyReport;
	diagnostics?: LiveDiagnostics;
	processIssue?: string;
}): AblationLadder & { rq3: HarnessFixAblation } {
	const ladder = ablationLadder(options);
	const rq3 = compareHarnessFixAblations({ informationBudgetHeld: ladder.informationBudgetHeld });
	return { ...ladder, rq3 };
}
