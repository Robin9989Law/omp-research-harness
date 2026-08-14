import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { loadExtensions } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import type { ExtensionContext, ToolCallEvent, ToolResultEvent } from "@oh-my-pi/pi-coding-agent";
import { EventBus } from "@oh-my-pi/pi-coding-agent/utils/event-bus";
import { inspectSpecialistCompletion, validateLifecycleState } from "../extensions/iph";

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
		"iph_event_snapshot",
		"iph_handover",
		"iph_register_exploration",
		"iph_repair_artifact_pointer",
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
	for (const toolName of expectedTools) {
		const registered = extension.tools.get(toolName);
		assert(registered?.definition.loadMode === "essential", `${toolName} is registered but not visible to the coordinator`);
	}

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
	assert(
		transitionPlan.content.some(item =>
			item.type === "text" &&
			item.text.includes('"readBeforeAct"') &&
			item.text.includes('"examples"') &&
			item.text.includes('"completionProof"')
		),
		"BOOT transition plan omitted the Agent-readable node briefing",
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
			nextAction: "Complete SCOPE_LOCK and advance exactly once to PRIOR_CLAIM_DRAIN.",
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
			nextAction: "Complete SCOPE_LOCK and advance exactly once to PRIOR_CLAIM_DRAIN.",
			strict: true,
		},
		main,
	);
	assert(rejectedAdvance.isError, "invalid target state unexpectedly committed");
	assert(
		rejectedAdvance.content.some(item => item.type === "text" && item.text.includes("transition_rolled_back=true")),
		`failed target validation did not report transactional rollback: ${JSON.stringify(rejectedAdvance)}`,
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
			nextAction: "Complete SCOPE_LOCK and advance exactly once to PRIOR_CLAIM_DRAIN.",
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
		advancedState.next_required_action === "Complete SCOPE_LOCK and advance exactly once to PRIOR_CLAIM_DRAIN.",
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
			nextAction: "Complete SCOPE_LOCK and advance exactly once to PRIOR_CLAIM_DRAIN.",
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
	const resumedBlocked = await execute(
		"iph_clear_lock",
		{
			recoveryNote: "operator restored the external capability",
			stateArtifacts: [],
			nextAction: "Complete SCOPE_LOCK and advance exactly once to PRIOR_CLAIM_DRAIN.",
			resumeBlocked: true,
			strict: true,
		},
		main,
	);
	assert(!resumedBlocked.isError, `BLOCKED resume failed: ${JSON.stringify(resumedBlocked)}`);
	const resumedState = JSON.parse(await readFile(statePath, "utf8"));
	assert(resumedState.active_state === "SCOPE_LOCK" && resumedState.resume_state === "SCOPE_LOCK", "BLOCKED did not resume atomically");
	assert(Array.isArray(resumedState.blocked_reasons) && resumedState.blocked_reasons.length === 0, "BLOCKED reasons survived recovery");
	assert(!existsSync(path.join(root, ".workflow_stop.lock")), "successful BLOCKED resume retained STOP lock");

	const ledgerHeader =
		"registry_id,canonical_url,identity_verification_url,publication_verification_url,peer_review_verification_url,status,checked_at,role\n";
	const oldLedgerPath = path.join(root, "near_neighbor_url_ledger.csv");
	const correctedLedgerPath = path.join(root, "near_neighbor_url_ledger.v2.csv");
	const oldLedger = `${ledgerHeader}W-TEST,https://example.org/work,https://example.org/work,https://example.org/work,https://example.org/work,VERIFIED,2026-08-14,original evidence\n`;
	const correctedLedger = `${ledgerHeader}W-TEST,https://example.org/work,https://example.org/work,https://example.org/work,https://example.org/work,VERIFIED,2026-08-14,versioned correction\n`;
	await writeFile(oldLedgerPath, oldLedger);
	await writeFile(correctedLedgerPath, correctedLedger);
	resumedState.artifacts.url_ledger = "near_neighbor_url_ledger.csv";
	await writeFile(statePath, `${JSON.stringify(resumedState, null, 2)}\n`);
	const repairedEvidencePointer = await execute(
		"iph_repair_artifact_pointer",
		{
			recoveryNote: "replace an active evidence ledger without rewriting its historical version",
			stateArtifacts: ["url_ledger=near_neighbor_url_ledger.v2.csv"],
			nextAction: "Complete SCOPE_LOCK and advance exactly once to PRIOR_CLAIM_DRAIN.",
			strict: true,
		},
		main,
	);
	assert(!repairedEvidencePointer.isError, `versioned evidence repair failed: ${JSON.stringify(repairedEvidencePointer)}`);
	const repairedState = JSON.parse(await readFile(statePath, "utf8"));
	assert(repairedState.artifacts?.url_ledger === "near_neighbor_url_ledger.v2.csv", "repair omitted the versioned ledger pointer");
	assert(await readFile(oldLedgerPath, "utf8") === oldLedger, "repair rewrote the historical evidence ledger");
	assert(await readFile(correctedLedgerPath, "utf8") === correctedLedger, "repair rewrote the corrected evidence ledger");

	repairedState.active_state = "PRIOR_CLAIM_DRAIN";
	repairedState.resume_state = "PRIOR_CLAIM_DRAIN";
	await writeFile(statePath, `${JSON.stringify(repairedState, null, 2)}\n`);
	const specialistCall = {
		type: "tool_call",
		toolCallId: "frontier-runtime-binding",
		toolName: "task",
		input: {
			context: "verify frontier artifacts",
			tasks: [{ name: "FrontierRuntime", agent: "frontier-auditor", task: "audit" }],
		},
	} satisfies ToolCallEvent;
	await toolCallHandlers[0]!(specialistCall, main);
	const specialistSessionFile = path.join(root, "frontier-runtime.jsonl");
	for (const status of ["started", "completed"] as const) {
		eventBus.emit("task:subagent:lifecycle", {
			id: "FrontierRuntime",
			agent: "frontier-auditor",
			agentSource: "project",
			status,
			sessionFile: specialistSessionFile,
			parentToolCallId: specialistCall.toolCallId,
			index: 0,
		});
	}
	assert(
		inspectSpecialistCompletion("FrontierRuntime", "frontier-auditor", root, "RECENT_FRONTIER").completed,
		"real task hook and lifecycle bus did not produce a root/target-bound specialist completion",
	);
	await toolResultHandlers[0]!({
		type: "tool_result",
		toolCallId: specialistCall.toolCallId,
		toolName: specialistCall.toolName,
		input: specialistCall.input,
		content: [{ type: "text", text: "specialist completed" }],
		details: {},
		isError: false,
	} satisfies ToolResultEvent, main);

	process.stdout.write("omp_e2e=READY loader=real tools=13 hooks=rollback specialist-schema=sanitized specialist=lifecycle-bound event-flow=projected transition=transactional blocked=committed+resumed frozen=decision-log mutable=guarded recovery=artifact-map+versioned-evidence root=nested reviewer=lifecycle\n");
} finally {
	await rm(root, { recursive: true, force: true });
}
