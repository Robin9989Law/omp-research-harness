import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { loadExtensions } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import type { ExtensionContext, ToolCallEvent, ToolResultEvent } from "@oh-my-pi/pi-coding-agent";
import { EventBus } from "@oh-my-pi/pi-coding-agent/utils/event-bus";
import { validateLifecycleState } from "../extensions/iph";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function context(cwd: string, sessionId: string, sessionFile: string): ExtensionContext {
	return {
		cwd,
		getSystemPrompt: () => [],
		sessionManager: {
			getSessionId: () => sessionId,
			getSessionFile: () => sessionFile,
		},
	} as unknown as ExtensionContext;
}

const projectRoot = path.resolve(import.meta.dir, "..");
const extensionPath = path.join(projectRoot, "extensions", "iph.ts");
const root = await mkdtemp(path.join(tmpdir(), "omp-iph-e2e-"));
const eventBus = new EventBus();

try {
	const loaded = await loadExtensions([extensionPath], root, eventBus);
	assert(loaded.errors.length === 0, `OMP loader rejected extension: ${JSON.stringify(loaded.errors)}`);
	assert(loaded.extensions.length === 1, `expected one loaded extension, found ${loaded.extensions.length}`);
	const extension = loaded.extensions[0]!;
	const expectedTools = [
		"iph_advance",
		"iph_bootstrap",
		"iph_clear_lock",
		"iph_handover",
		"iph_register_exploration",
		"iph_repair_collision_round",
		"iph_review",
		"iph_start_collision_round",
		"iph_status",
		"iph_transition_plan",
		"iph_validate",
	];
	assert(
		JSON.stringify([...extension.tools.keys()].sort()) === JSON.stringify(expectedTools),
		`unexpected OMP tool registry: ${JSON.stringify([...extension.tools.keys()].sort())}`,
	);

	const mainSessionFile = path.join(root, "main-session.jsonl");
	const main = context(root, "main-session", mainSessionFile);
	const execute = async (name: string, params: Record<string, unknown>, ctx: ExtensionContext) => {
		const registered = extension.tools.get(name);
		assert(registered, `OMP did not register ${name}`);
		return registered.definition.execute(`call-${name}`, params as never, undefined, undefined, ctx);
	};

	const boot = await execute(
		"iph_bootstrap",
		{ workflowId: "omp-e2e", outputType: "JOURNAL_ARTICLE", claimProfile: "MIXED" },
		main,
	);
	assert(!boot.isError, `OMP-loaded iph_bootstrap failed: ${JSON.stringify(boot)}`);
	const statePath = path.join(root, "workflow_state.json");
	const lifecyclePath = path.join(root, "lifecycle_state.json");
	const originalState = await readFile(statePath, "utf8");
	const lifecycle = JSON.parse(await readFile(lifecyclePath, "utf8"));
	assert(validateLifecycleState(lifecycle, "E2").length === 0, "bootstrap wrote a noncanonical lifecycle state");
	const status = await execute("iph_status", {}, main);
	assert(!status.isError, `read-only iph_status failed: ${JSON.stringify(status)}`);
	assert(
		status.content.some(item => item.type === "text" && item.text.includes('"validation": "NOT_RUN_READ_ONLY_SNAPSHOT"')),
		"iph_status blurred a read-only snapshot with validator output",
	);
	const transitionPlan = await execute("iph_transition_plan", {}, main);
	assert(!transitionPlan.isError, `BOOT transition plan failed: ${JSON.stringify(transitionPlan)}`);
	assert(
		transitionPlan.content.some(item => item.type === "text" && item.text.includes('"target": "SCOPE_LOCK"')),
		"BOOT transition plan omitted the deterministic target",
	);

	const nested = path.join(root, "analysis", "figures");
	await mkdir(nested, { recursive: true });
	const nestedMain = context(nested, "main-session", mainSessionFile);
	const validation = await execute("iph_validate", { strict: true }, nestedMain);
	assert(!validation.isError, `nested-root iph_validate failed: ${JSON.stringify(validation)}`);

	const beforeHandlers = extension.handlers.get("before_agent_start") ?? [];
	assert(beforeHandlers.length > 0, "OMP did not register before_agent_start");
	const before = (await beforeHandlers[0]!({ type: "before_agent_start", prompt: "", systemPrompt: [] }, nestedMain)) as {
		systemPrompt?: string[];
	};
	assert(before.systemPrompt?.join("\n").includes('"active_state": "BOOT"'), "nested session did not receive BOOT state context");

	const toolCallHandlers = extension.handlers.get("tool_call") ?? [];
	const toolResultHandlers = extension.handlers.get("tool_result") ?? [];
	assert(toolCallHandlers.length > 0 && toolResultHandlers.length > 0, "OMP did not register tool security hooks");
	const directWrite = (await toolCallHandlers[0]!(
		{
			type: "tool_call",
			toolCallId: "direct-write",
			toolName: "write",
			input: { path: statePath, content: "tamper" },
		} satisfies ToolCallEvent,
		nestedMain,
	)) as { block?: boolean };
	assert(directWrite.block === true, "OMP tool_call hook did not block direct workflow mutation");

	const malformedSpecialist = (await toolCallHandlers[0]!(
		{
			type: "tool_call",
			toolCallId: "malformed-specialist-schema",
			toolName: "task",
			input: {
				context: "frontier gate",
				tasks: [{
					name: "FrontierAudit",
					agent: "frontier-auditor",
					task: "write the contracted artifacts",
					outputSchema: "{malformed",
					schemaMode: "strict",
				}],
			},
		} satisfies ToolCallEvent,
		nestedMain,
	)) as { input?: Record<string, unknown> };
	const sanitizedTasks = malformedSpecialist.input?.tasks as Array<Record<string, unknown>> | undefined;
	assert(
		sanitizedTasks?.length === 1 &&
		!Object.hasOwn(sanitizedTasks[0]!, "outputSchema") &&
		!Object.hasOwn(sanitizedTasks[0]!, "schemaMode"),
		"OMP tool_call hook did not remove a specialist caller schema",
	);
	await toolResultHandlers[0]!(
		{
			type: "tool_result",
			toolCallId: "malformed-specialist-schema",
			toolName: "task",
			input: malformedSpecialist.input ?? {},
			content: [{ type: "text", text: "specialist task completed" }],
			details: {},
			isError: false,
		} satisfies ToolResultEvent,
		nestedMain,
	);

	const customCall = {
		type: "tool_call",
		toolCallId: "custom-bypass",
		toolName: "custom_node_tool",
		input: {},
	} satisfies ToolCallEvent;
	const preflight = (await toolCallHandlers[0]!(customCall, nestedMain)) as { block?: boolean } | undefined;
	assert(!preflight?.block, "custom tool was unexpectedly blocked before the tamper test");
	await writeFile(statePath, "tampered outside write/bash regex\n");
	const rollback = (await toolResultHandlers[0]!(
		{
			type: "tool_result",
			toolCallId: customCall.toolCallId,
			toolName: customCall.toolName,
			input: {},
			content: [{ type: "text", text: "custom tool completed" }],
			details: {},
			isError: false,
		} satisfies ToolResultEvent,
		nestedMain,
	)) as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
	assert(rollback.isError === true, "OMP tool_result hook did not mark rolled-back tamper as an error");
	assert(await readFile(statePath, "utf8") === originalState, "OMP tool_result hook did not restore workflow_state.json");

	await writeFile(path.join(root, "scope_lock.md"), "# Scope lock\n");
	await writeFile(path.join(root, "hierarchy_status.md"), "# Hierarchy status\n");
	await writeFile(path.join(root, "near_neighbor_registry.json"), "{}\n");
	const mutableFreeze = await execute(
		"iph_advance",
		{
			to: "SCOPE_LOCK",
			note: "attempt to freeze a mutable registry",
			gates: [],
			artifacts: ["near_neighbor_registry.json"],
			stateArtifacts: ["literature_registry=near_neighbor_registry.json"],
			nextAction: "Do not commit this transition.",
			strict: true,
		},
		main,
	);
	assert(mutableFreeze.isError, "mutable pointer artifact was accepted as an immutable decision hash");
	assert(
		mutableFreeze.content.some(item => item.type === "text" && item.text.includes("must not be frozen")),
		"mutable artifact rejection omitted the recovery diagnosis",
	);
	assert(await readFile(statePath, "utf8") === originalState, "mutable artifact rejection changed workflow state");
	await rm(path.join(root, "near_neighbor_registry.json"));
	const rejectedAdvance = await execute(
		"iph_advance",
		{
			to: "SCOPE_LOCK",
			note: "intentionally omit state pointers",
			gates: ["scope_locked=true"],
			artifacts: ["scope_lock.md", "hierarchy_status.md"],
			stateArtifacts: [],
			nextAction: "Drain prior-round claims before frontier search.",
			strict: true,
		},
		main,
	);
	assert(rejectedAdvance.isError, "invalid target state unexpectedly committed");
	assert(
		rejectedAdvance.content.some(item => item.type === "text" && item.text.includes("transition_rolled_back=true")),
		"failed target validation did not report transactional rollback",
	);
	assert(await readFile(statePath, "utf8") === originalState, "failed target validation left workflow_state.json advanced");
	assert(!Bun.file(path.join(root, ".workflow_stop.lock")).size, "failed target validation left a STOP lock after rollback");
	const advance = await execute(
		"iph_advance",
		{
			to: "SCOPE_LOCK",
			note: "scope contract frozen",
			gates: ["scope_locked=true"],
			artifacts: ["scope_lock.md", "hierarchy_status.md"],
			stateArtifacts: ["scope_lock=scope_lock.md", "hierarchy_status=hierarchy_status.md"],
			nextAction: "Drain prior-round claims before frontier search.",
			strict: true,
		},
		main,
	);
	assert(!advance.isError, `atomic BOOT to SCOPE_LOCK advance failed: ${JSON.stringify(advance)}`);
	const advancedState = JSON.parse(await readFile(statePath, "utf8"));
	assert(advancedState.artifacts?.scope_lock === "scope_lock.md", "advance omitted the scope_lock state pointer");
	assert(
		advancedState.artifacts?.hierarchy_status === "hierarchy_status.md",
		"advance omitted the hierarchy_status state pointer",
	);
	assert(
		advancedState.next_required_action === "Drain prior-round claims before frontier search.",
		"advance left a stale next_required_action",
	);

	const frozenScopeCall = {
		type: "tool_call",
		toolCallId: "frozen-scope-bypass",
		toolName: "custom_node_tool",
		input: {},
	} satisfies ToolCallEvent;
	await toolCallHandlers[0]!(frozenScopeCall, main);
	await writeFile(path.join(root, "scope_lock.md"), "# tampered scope\n");
	const frozenScopeRollback = (await toolResultHandlers[0]!(
		{
			type: "tool_result",
			toolCallId: frozenScopeCall.toolCallId,
			toolName: frozenScopeCall.toolName,
			input: {},
			content: [{ type: "text", text: "custom tool completed" }],
			details: {},
			isError: false,
		} satisfies ToolResultEvent,
		main,
	)) as { isError?: boolean };
	assert(frozenScopeRollback.isError === true, "decision-log artifact tamper was not rolled back");
	assert(await readFile(path.join(root, "scope_lock.md"), "utf8") === "# Scope lock\n", "scope lock was not restored");

	delete advancedState.artifacts.scope_lock;
	delete advancedState.artifacts.hierarchy_status;
	await writeFile(statePath, `${JSON.stringify(advancedState, null, 2)}\n`);
	const invalidPointers = await execute("iph_validate", { strict: true }, main);
	assert(invalidPointers.isError, "validator accepted a gate with missing top-level artifact pointers");
	const recoveredPointers = await execute(
		"iph_clear_lock",
		{
			recoveryNote: "registered missing scope artifact pointers",
			stateArtifacts: ["scope_lock=scope_lock.md", "hierarchy_status=hierarchy_status.md"],
			nextAction: "Drain prior-round claims before frontier search.",
			strict: true,
		},
		main,
	);
	assert(!recoveredPointers.isError, `STOP artifact-pointer recovery failed: ${JSON.stringify(recoveredPointers)}`);
	const recoveredState = JSON.parse(await readFile(statePath, "utf8"));
	assert(recoveredState.artifacts?.scope_lock === "scope_lock.md", "recovery omitted the scope_lock pointer");
	assert(
		recoveredState.artifacts?.hierarchy_status === "hierarchy_status.md",
		"recovery omitted the hierarchy_status pointer",
	);

	const parentReview = await execute("iph_review", { verdict: "FAIL", strict: true }, nestedMain);
	assert(parentReview.isError, "parent session unexpectedly acquired reviewer authority");
	assert(
		parentReview.content.some(item => item.type === "text" && item.text.includes("reviewer-only")),
		"parent reviewer rejection did not identify missing runtime provenance",
	);

	const reviewerSessionFile = path.join(root, "reviewer-session.jsonl");
	eventBus.emit("task:subagent:lifecycle", {
		id: "omp-review-task-1",
		agent: "iph-reviewer",
		agentSource: "project",
		status: "started",
		sessionFile: reviewerSessionFile,
		index: 0,
	});
	const reviewer = context(nested, "reviewer-session", reviewerSessionFile);
	const reviewerReview = await execute("iph_review", { verdict: "FAIL", strict: true }, reviewer);
	assert(reviewerReview.isError, "BOOT state unexpectedly accepted an independent review");
	assert(
		reviewerReview.content.some(item => item.type === "text" && item.text.includes("only allowed in INDEPENDENT_REVIEW")),
		"real lifecycle identity was not propagated into the reviewer tool path",
	);

	const expectedBlocked = await execute(
		"iph_advance",
		{
			to: "BLOCKED",
			note: "record an unavailable external capability",
			gates: [],
			artifacts: [],
			stateArtifacts: [],
			nextAction: "Restore the unavailable capability, then clear the STOP lock with an exact recovery note.",
			blockedReason: "required external research capability is unavailable",
			strict: true,
		},
		main,
	);
	assert(expectedBlocked.isError, "committed BLOCKED status did not preserve exit code 2");
	assert(
		expectedBlocked.content.some(item => item.type === "text" && item.text.includes("EXPECTED_BLOCKED_COMMIT")),
		"legitimate BLOCKED transition was not identified as committed",
	);
	assert(
		!expectedBlocked.content.some(item => item.type === "text" && item.text.includes("transition_rolled_back=true")),
		"legitimate BLOCKED transition was rolled back",
	);
	const blockedState = JSON.parse(await readFile(statePath, "utf8"));
	assert(blockedState.active_state === "BLOCKED" && blockedState.resume_state === "SCOPE_LOCK", "BLOCKED state was not persisted");
	assert(Bun.file(path.join(root, ".workflow_stop.lock")).size > 0, "committed BLOCKED state omitted the STOP lock");

	process.stdout.write("omp_e2e=READY loader=real tools=11 hooks=rollback specialist-schema=sanitized transition=transactional blocked=committed frozen=decision-log mutable=guarded recovery=artifact-map root=nested reviewer=lifecycle\n");
} finally {
	await rm(root, { recursive: true, force: true });
}
