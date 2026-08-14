import type { FailureClass, RepairSpec, TraceStep } from "./types";

export function attributeFailure(options: {
	failureClass: FailureClass;
	message: string;
	steps?: TraceStep[];
	anchors?: string[];
}): RepairSpec {
	const last = options.steps?.at(-1);
	const evidence = last
		? `HTIR step ${last.id} ${last.name ?? last.rawType} status=${last.status} message≠completed=${last.isMessageOnly}`
		: options.message;
	const hubWait = /hub wait|pending hub/i.test(options.message)
		|| options.steps?.some(step => step.name === "hub" && (step.op === "wait" || step.op === "jobs" || !step.op));
	if (hubWait && (options.failureClass === "ELICITATION_REGRESSION" || options.failureClass === "EFFICIENCY_REGRESSION")) {
		return {
			operator: "restore_task_lifecycle",
			layer: "Lifecycle",
			anchors: options.anchors ?? ["agents/frontier-auditor.md", "SYSTEM.md"],
			regressionSet: ["L0", "L5", "role-scorecard"],
			concern: "M3 polled a specialist with hub wait instead of task lifecycle completion",
			evidence: options.message,
			suggestion: "Spawn specialists with task, wait on lifecycle completed, then iph_advance. Do not poll with hub wait, and do not add step scripts.",
		};
	}
	if (options.failureClass === "ELICITATION_REGRESSION") {
		return {
			operator: "delete_suppressing_scaffold",
			layer: "Context",
			anchors: options.anchors ?? [last?.anchor ?? "SYSTEM.md"],
			regressionSet: ["L0", "L1", last?.anchor ?? "role-scorecard"],
			concern: "Role closed an edge without discovering, narrowing, or finishing the work",
			evidence,
			suggestion: "Restore the find→optimize→finish loop. Do not add step scripts to force a green outcome.",
		};
	}
	if (options.failureClass === "EFFICIENCY_REGRESSION") {
		const skip = /skip-axes/i.test(options.message);
		return {
			operator: skip ? "restore_adjacent_commit" : "isolate_run_root",
			layer: "Execution",
			anchors: options.anchors ?? [skip ? "extensions/iph.ts" : "sif/cli.ts"],
			regressionSet: ["L0", "L2"],
			concern: skip
				? "The run skipped adjacent positive-path states"
				: "The update cannot complete efficiently: deadlock, wasted tools, or rerun of unaffected nodes",
			evidence: options.message || evidence,
			suggestion: skip
				? "Commit one adjacent edge at a time. Overrun is a warning, not permission to skip gates."
				: "Reuse reuseKey hits, first-fail-stop, and context-reset isolated run roots. Do not grep the filesystem root.",
		};
	}
	const layer = last?.etcLayer ?? "Verification";
	const operator = layer === "Lifecycle"
		? "restore_lifecycle_monotonicity"
		: layer === "Governance"
			? "restore_identity_governance"
			: layer === "Tooling"
				? "tighten_tool_schema"
				: "strengthen_validator_gate";
	return {
		operator,
		layer,
		anchors: options.anchors ?? [last?.anchor ?? "extensions/iph.ts"],
		regressionSet: ["L0", "L1", "L2"],
		concern: options.message,
		evidence,
		suggestion: "Apply the scoped operator only to the anchored artifacts; reject free-form harness edits.",
	};
}
