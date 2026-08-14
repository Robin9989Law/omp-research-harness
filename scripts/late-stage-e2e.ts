import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { loadExtensions } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import type { ExtensionContext, ToolCallEvent, ToolResultEvent } from "@oh-my-pi/pi-coding-agent";
import { EventBus } from "@oh-my-pi/pi-coding-agent/utils/event-bus";

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

const fixtureRoot = path.resolve(process.argv[2] ?? "");
assert(fixtureRoot && await Bun.file(path.join(fixtureRoot, "direction_lock", "workflow_state.json")).exists(),
	"usage: bun scripts/late-stage-e2e.ts <generated-agent-node-fixture-root>");

const projectRoot = path.resolve(import.meta.dir, "..");
const root = await mkdtemp(path.join(tmpdir(), "iph-late-stage-e2e-"));
const eventBus = new EventBus();

try {
	await cp(path.join(fixtureRoot, "direction_lock"), root, { recursive: true });
	const loaded = await loadExtensions([path.join(projectRoot, "extensions", "iph.ts")], root, eventBus);
	assert(loaded.errors.length === 0 && loaded.extensions.length === 1, `extension load failed: ${JSON.stringify(loaded.errors)}`);
	const extension = loaded.extensions[0]!;
	const mainSessionFile = path.join(root, "late-main.jsonl");
	const main = context(root, "late-main", mainSessionFile);
	const execute = async (name: string, params: Record<string, unknown>, ctx = main) => {
		const tool = extension.tools.get(name);
		assert(tool, `missing tool ${name}`);
		return tool.definition.execute(`call-${name}`, params as never, undefined, undefined, ctx);
	};
	const statePath = path.join(root, "workflow_state.json");
	const readState = async () => JSON.parse(await readFile(statePath, "utf8")) as Record<string, any>;
	const assertState = async (active: string, validity: string, computeStage: string, epoch: number) => {
		const state = await readState();
		assert(state.active_state === active, `expected ${active}, found ${state.active_state}`);
		assert(state.validity_level === validity, `expected ${validity}, found ${state.validity_level}`);
		assert(state.compute_stage === computeStage, `expected ${computeStage}, found ${state.compute_stage}`);
		assert(state.validation_epoch === epoch, `expected epoch ${epoch}, found ${state.validation_epoch}`);
		return state;
	};

	const beforeUnauthorized = await readFile(statePath, "utf8");
	const unauthorized = await execute("iph_advance", {
		to: "COMPUTE",
		note: "attempt compute without explicit authorization note",
		gates: ["compute_authorized=true"],
		artifacts: [],
		stateArtifacts: [],
		nextAction: "Complete COMPUTE and advance exactly once to POSTCOMPUTE_CLAIM_FREEZE.",
		strict: true,
	});
	assert(unauthorized.isError, "DIRECTION_LOCK accepted COMPUTE without an authorization note");
	assert(await readFile(statePath, "utf8") === beforeUnauthorized, "unauthorized COMPUTE changed state");

	const node18 = await execute("iph_advance", {
		to: "COMPUTE",
		note: "enter the explicitly authorized compute funnel",
		gates: ["compute_authorized=true"],
		artifacts: [],
		stateArtifacts: [],
		nextAction: "Complete COMPUTE and advance exactly once to POSTCOMPUTE_CLAIM_FREEZE.",
		computeAuthorizationNote: "The user explicitly authorized research computation in this thread.",
		strict: true,
	});
	assert(!node18.isError, `node 18 failed: ${JSON.stringify(node18)}`);
	await assertState("COMPUTE", "V3", "S0", 1);

	const node19 = await execute("iph_advance", {
		to: "POSTCOMPUTE_CLAIM_FREEZE",
		note: "register completed S4 compute evidence",
		gates: [],
		artifacts: [],
		stateArtifacts: [],
		nextAction: "Complete POSTCOMPUTE_CLAIM_FREEZE and advance exactly once to FINAL_VALIDITY_AUDIT.",
		computeEvidence: "compute_evidence.json",
		strict: true,
	});
	assert(!node19.isError, `node 19 failed: ${JSON.stringify(node19)}`);
	const postcompute = await assertState("POSTCOMPUTE_CLAIM_FREEZE", "V3", "S4", 1);
	assert(postcompute.compute_evidence?.status === "COMPLETED", "node 19 omitted completed compute evidence");

	const node20 = await execute("iph_advance", {
		to: "FINAL_VALIDITY_AUDIT",
		note: "freeze the epoch-two postcompute claim bundle",
		gates: [],
		artifacts: [],
		stateArtifacts: [
			"claim_inventory=postcompute/claim_inventory.json",
			"audit_manifest=postcompute/audit_manifest.json",
			"theory_obligations=postcompute/theory_obligation_registry.json",
			"protocol_contract=postcompute/protocol_contract.json",
			"claim_code_trace=postcompute/claim_code_trace.json",
			"baseline_budget=postcompute/baseline_budget.json",
		],
		nextAction: "Complete FINAL_VALIDITY_AUDIT and advance exactly once to FINAL_LOCK.",
		claimBundleManifest: "postcompute/audit_manifest.json",
		strict: true,
	});
	assert(!node20.isError, `node 20 failed: ${JSON.stringify(node20)}`);
	await assertState("FINAL_VALIDITY_AUDIT", "V3", "S4", 2);

	const toolCallHandlers = extension.handlers.get("tool_call") ?? [];
	const toolResultHandlers = extension.handlers.get("tool_result") ?? [];
	assert(toolCallHandlers.length > 0 && toolResultHandlers.length > 0, "review task hooks unavailable");
	const parentTask = {
		type: "tool_call",
		toolCallId: "late-review-parent",
		toolName: "task",
		input: { tasks: [{ name: "ReviewEpochTwo", agent: "iph-reviewer", task: "Independently audit the epoch-two frozen bundle." }] },
	} satisfies ToolCallEvent;
	const parentPreflight = (await toolCallHandlers[0]!(parentTask, main)) as { block?: boolean } | undefined;
	assert(!parentPreflight?.block, "node 21 reviewer task was blocked");

	const reviewerSessionFile = path.join(root, "late-reviewer.jsonl");
	await writeFile(reviewerSessionFile, `${JSON.stringify({
		type: "model_change",
		model: "deepseek/deepseek-v4-pro",
		resolvedModelIsFallback: false,
	})}\n`);
	eventBus.emit("task:subagent:lifecycle", {
		id: "late-reviewer-task-2",
		agent: "iph-reviewer",
		agentSource: "project",
		status: "started",
		sessionFile: reviewerSessionFile,
		parentToolCallId: parentTask.toolCallId,
		index: 0,
	});
	const reviewer = context(root, "late-reviewer-thread-2", reviewerSessionFile);
	const auditRelative = "review_artifacts/epoch-2-runtime.json";
	const sourceAudit = JSON.parse(await readFile(path.join(fixtureRoot, "final_lock", "review_artifacts", "epoch-2.json"), "utf8"));
	delete sourceAudit.reviewer_agent_id;
	delete sourceAudit.reviewer_thread_id;
	delete sourceAudit.audited_at;
	const reviewerWrite = {
		type: "tool_call",
		toolCallId: "late-review-write",
		toolName: "write",
		input: { path: path.join(root, auditRelative), content: "epoch-two review" },
	} satisfies ToolCallEvent;
	const reviewerWritePreflight = (await toolCallHandlers[0]!(reviewerWrite, reviewer)) as { block?: boolean } | undefined;
	assert(!reviewerWritePreflight?.block, "authenticated epoch-two reviewer could not write its artifact");
	await mkdir(path.join(root, "review_artifacts"), { recursive: true });
	await writeFile(path.join(root, auditRelative), `${JSON.stringify(sourceAudit, null, 2)}\n`);
	await toolResultHandlers[0]!({
		type: "tool_result",
		toolCallId: reviewerWrite.toolCallId,
		toolName: reviewerWrite.toolName,
		input: reviewerWrite.input,
		content: [{ type: "text", text: "epoch-two audit written" }],
		details: {},
		isError: false,
	} satisfies ToolResultEvent, reviewer);
	const sealed = await execute("iph_review", { verdict: "PASS", auditPath: auditRelative, strict: true }, reviewer);
	assert(!sealed.isError, `node 21 review seal failed: ${JSON.stringify(sealed)}`);
	eventBus.emit("task:subagent:lifecycle", {
		id: "late-reviewer-task-2",
		agent: "iph-reviewer",
		agentSource: "project",
		status: "completed",
		sessionFile: reviewerSessionFile,
		parentToolCallId: parentTask.toolCallId,
		index: 0,
	});
	const parentResult = (await toolResultHandlers[0]!({
		type: "tool_result",
		toolCallId: parentTask.toolCallId,
		toolName: parentTask.toolName,
		input: parentTask.input,
		content: [{ type: "text", text: "epoch-two reviewer completed" }],
		details: {},
		isError: false,
	} satisfies ToolResultEvent, main)) as { isError?: boolean } | undefined;
	assert(!parentResult?.isError, "node 21 parent boundary rolled back the sealed review");
	await assertState("FINAL_VALIDITY_AUDIT", "V4", "S4", 2);

	const node21 = await execute("iph_advance", {
		to: "FINAL_LOCK",
		note: "accept the independently sealed epoch-two audit",
		gates: [],
		artifacts: [],
		stateArtifacts: [],
		nextAction: "Complete FINAL_LOCK and advance exactly once to COMPLETE.",
		specialistAgentId: "late-reviewer-task-2",
		specialistDisposition: "ACCEPTED",
		specialistRationale: "The epoch-two audit is runtime-bound, hash-matched, artifact-grounded, and strict validation passed.",
		strict: true,
	});
	assert(!node21.isError, `node 21 advance failed: ${JSON.stringify(node21)}`);
	await assertState("FINAL_LOCK", "V4", "S4", 2);

	const node22 = await execute("iph_advance", {
		to: "COMPLETE",
		note: "complete the fully reviewed epoch-two workflow",
		gates: [],
		artifacts: [],
		stateArtifacts: [],
		nextAction: "Workflow complete; do not advance further.",
		strict: true,
	});
	assert(!node22.isError, `node 22 failed: ${JSON.stringify(node22)}`);
	await assertState("COMPLETE", "V4", "S4", 2);
	process.stdout.write(`late_stage_e2e=READY nodes=18-22 compute_auth=denied+accepted s4=registered epoch=1->2 reviewer=runtime-bound parent_snapshot=preserved final=COMPLETE root=${root}\n`);
} finally {
	await rm(root, { recursive: true, force: true });
}
