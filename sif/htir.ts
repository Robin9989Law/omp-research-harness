import { readdir, readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import { xdIphToolName } from "../extensions/iph";
import type { EtcLayer, Htir, TraceEffect, TraceLink, TraceStatus, TraceStep } from "./types";

type JsonObject = Record<string, unknown>;

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage"]);

async function jsonlFiles(root: string): Promise<string[]> {
	const metadata = await stat(root).catch(() => undefined);
	if (!metadata) return [];
	if (metadata.isFile()) return root.endsWith(".jsonl") ? [root] : [];
	const found: string[] = [];
	const visit = async (directory: string): Promise<void> => {
		for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
			const absolute = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) await visit(absolute);
				continue;
			}
			if (entry.isFile() && entry.name.endsWith(".jsonl")) found.push(absolute);
		}
	};
	await visit(root);
	return found.sort();
}

function asObject(value: unknown): JsonObject {
	return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function toolName(content: JsonObject): { name: string; bridged?: string; args: JsonObject; callId?: string; intent?: string } | undefined {
	if (content.type !== "toolCall" || typeof content.name !== "string") return undefined;
	const args = asObject(content.arguments);
	const bridged = xdIphToolName(content.name, args);
	const callId = typeof content.id === "string" ? content.id : undefined;
	const intent = typeof content.intent === "string" ? content.intent : typeof args.i === "string" ? args.i : undefined;
	return { name: bridged ?? content.name, bridged: bridged ? content.name : undefined, args, callId, intent };
}

function effectFor(name: string): TraceEffect {
	if (name.startsWith("iph_status") || name === "iph_transition_plan" || name === "iph_event_snapshot") return "read";
	if (name === "iph_advance" || name === "iph_bootstrap" || name === "iph_clear_lock" || name === "iph_review") return "state";
	if (name === "write" || name === "edit" || name === "iph_repair_artifact_pointer") return "artifact";
	if (name === "read" || name === "glob" || name === "grep" || name === "bash") return "read";
	return "unknown";
}

function layerFor(name: string, type: string): EtcLayer {
	if (name === "iph_review" || name.includes("identity") || type === "model_change") return "Governance";
	if (name.startsWith("iph_validate") || name === "iph_advance") return "Verification";
	if (type === "task:subagent:lifecycle" || name === "task") return "Lifecycle";
	if (name === "iph_status" || name === "iph_transition_plan" || name === "iph_event_snapshot") return "Context";
	if (name.startsWith("iph_") || name === "write") return "Tooling";
	return "Observability";
}

function anchorFor(name: string, agent?: string): string {
	if (agent === "frontier-auditor" || /frontier/i.test(agent ?? "")) return "agents/frontier-auditor.md";
	if (agent === "layer-adjudicator" || /layer/i.test(agent ?? "")) return "agents/layer-adjudicator.md";
	if (agent === "atomic-claim-extractor" || /atomic/i.test(agent ?? "")) return "agents/atomic-claim-extractor.md";
	if (agent === "collision-synthesizer" || /collision/i.test(agent ?? "")) return "agents/collision-synthesizer.md";
	if (agent === "iph-reviewer" || /reviewer/i.test(agent ?? "")) return "agents/iph-reviewer.md";
	if (agent === "event-flow-manager" || /event-flow/i.test(agent ?? "")) return "agents/event-flow-manager.md";
	if (name.startsWith("iph_") || name === "write") return "extensions/iph.ts";
	return "SYSTEM.md";
}

function statusOf(type: string, lifecycle?: string): TraceStatus {
	if (lifecycle === "completed" || type === "completed") return "completed";
	if (lifecycle === "failed" || type === "failed") return "failure";
	if (lifecycle === "started" || type === "started") return "started";
	if (type === "message") return "message";
	return "success";
}

function roleOf(entry: JsonObject, fallback = "M3"): string {
	if (typeof entry.agent === "string" && entry.agent) return entry.agent;
	if (typeof entry.modelRole === "string" && entry.modelRole) return entry.modelRole;
	return fallback;
}

function detailFor(name: string, args: JsonObject): string | undefined {
	if (name === "hub" && typeof args.op === "string") return args.op;
	if (name === "bash" && typeof args.command === "string") return args.command.slice(0, 240);
	return undefined;
}

function mergeStep(existing: TraceStep, incoming: TraceStep): TraceStep {
	return {
		...existing,
		...incoming,
		id: existing.id,
		isMessageOnly: existing.isMessageOnly && incoming.isMessageOnly,
		isLifecycleCompleted: existing.isLifecycleCompleted || incoming.isLifecycleCompleted,
		disposition: incoming.disposition ?? existing.disposition,
		targetState: incoming.targetState ?? existing.targetState,
		specialistAgentId: incoming.specialistAgentId ?? existing.specialistAgentId,
		op: incoming.op ?? existing.op,
		intent: incoming.intent ?? existing.intent,
		detail: incoming.detail ?? existing.detail,
		status: incoming.status === "message" ? existing.status : incoming.status,
	};
}

export function emptyHtir(researchRoot?: string): Htir {
	return { schemaVersion: "1.0", researchRoot, steps: [] };
}

export function compileTraceLinks(steps: TraceStep[]): TraceLink[] {
	const links: TraceLink[] = [];
	const seen = new Set<string>();
	const addLink = (link: TraceLink) => {
		const key = `${link.sourceId}->${link.targetId}:${link.kind}:${link.relation}`;
		if (!seen.has(key)) {
			seen.add(key);
			links.push(link);
		}
	};

	let lastPlanOrStatus: TraceStep | undefined;
	let lastValidate: TraceStep | undefined;
	let lastAdvance: TraceStep | undefined;
	let lastTask: TraceStep | undefined;

	for (let index = 0; index < steps.length; index += 1) {
		const current = steps[index]!;
		const previous = index > 0 ? steps[index - 1] : undefined;

		if (current.name === "iph_status" || current.name === "iph_transition_plan") {
			lastPlanOrStatus = current;
		}

		if (current.name === "iph_validate") {
			lastValidate = current;
			if (previous && previous.id !== current.id) {
				addLink({ sourceId: previous.id, targetId: current.id, kind: "control", relation: "validate" });
			} else if (lastPlanOrStatus && lastPlanOrStatus.id !== current.id) {
				addLink({ sourceId: lastPlanOrStatus.id, targetId: current.id, kind: "control", relation: "validate" });
			}
		}

		if (current.name === "task" || (current.name === "hub" && (current.op === "wait" || current.op === "jobs"))) {
			lastTask = current;
			if (previous && previous.id !== current.id && previous.name !== current.name) {
				addLink({ sourceId: previous.id, targetId: current.id, kind: "control", relation: "delegate" });
			}
		}

		if (current.name === "task:subagent:lifecycle" || (current.role && current.role !== "M3" && current.role !== "default")) {
			if (lastTask && lastTask.id !== current.id) {
				addLink({ sourceId: lastTask.id, targetId: current.id, kind: "control", relation: "delegate" });
			}
		}

		if (current.name === "iph_advance") {
			if (lastAdvance && lastAdvance.targetState && lastAdvance.targetState === current.targetState && lastAdvance.id !== current.id) {
				addLink({ sourceId: lastAdvance.id, targetId: current.id, kind: "control", relation: "retry" });
			}
			if (lastPlanOrStatus && lastPlanOrStatus.id !== current.id) {
				addLink({ sourceId: lastPlanOrStatus.id, targetId: current.id, kind: "data", relation: "produces" });
			}
			if (lastValidate && lastValidate.id !== current.id) {
				addLink({ sourceId: lastValidate.id, targetId: current.id, kind: "control", relation: "finalize" });
			} else if (previous && previous.id !== current.id && previous.name !== "iph_advance") {
				addLink({ sourceId: previous.id, targetId: current.id, kind: "control", relation: "finalize" });
			}
			lastAdvance = current;
			lastPlanOrStatus = undefined;
			lastValidate = undefined;
			lastTask = undefined;
		}
	}
	return links;
}

export async function compileHtir(options: {
	traceRoot: string;
	researchRoot?: string;
}): Promise<Htir> {
	const byId = new Map<string, TraceStep>();
	const anonymous: TraceStep[] = [];
	const pendingToolCalls: NonNullable<Htir["pendingToolCalls"]> = [];
	const sessionExits: NonNullable<Htir["sessionExits"]> = [];
	let nextId = 0;

	const push = (step: Omit<TraceStep, "id"> & { id?: number }): void => {
		nextId += 1;
		const written: TraceStep = { ...step, id: step.id ?? nextId };
		if (written.callId) {
			const existing = byId.get(written.callId);
			if (existing) {
				byId.set(written.callId, mergeStep(existing, written));
				return;
			}
			byId.set(written.callId, written);
			return;
		}
		anonymous.push(written);
	};

	const files = await jsonlFiles(options.traceRoot);
	const rootForRelative = (await stat(options.traceRoot).catch(() => undefined))?.isFile()
		? path.dirname(options.traceRoot)
		: options.traceRoot;
	for (const file of files) {
		const relative = path.relative(rootForRelative, file);
		let fileRole = /frontier/i.test(relative) ? "frontier-auditor"
			: /layer/i.test(relative) ? "layer-adjudicator"
			: /atomic/i.test(relative) ? "atomic-claim-extractor"
			: /collision/i.test(relative) ? "collision-synthesizer"
			: /reviewer/i.test(relative) ? "iph-reviewer"
			: "M3";
		const metadata = await stat(file).catch(() => undefined);
		if (!metadata) continue;
		for (const line of (await readFile(file, "utf8")).split("\n")) {
			if (!line.trim()) continue;
			let entry: JsonObject;
			try {
				entry = JSON.parse(line) as JsonObject;
			} catch {
				continue;
			}
			if (typeof entry.agent === "string" && entry.agent) fileRole = entry.agent;
			else if (typeof entry.modelRole === "string" && entry.modelRole) fileRole = entry.modelRole;
			const type = String(entry.type ?? "");
			const message = asObject(entry.message);
			const agent = roleOf(entry, fileRole);
			const lifecycle = typeof entry.status === "string" ? entry.status : undefined;
			const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : undefined;
			if (type === "message" && message.role === "assistant") {
				const contents = Array.isArray(message.content) ? message.content : [];
				for (const content of contents) {
					const tool = toolName(asObject(content));
					if (!tool) continue;
					push({
						sourceFile: relative,
						role: agent,
						status: "message",
						effect: effectFor(tool.name),
						name: tool.name,
						isLifecycleCompleted: false,
						isMessageOnly: true,
						bridgedTool: tool.bridged,
						etcLayer: layerFor(tool.name, type),
						anchor: anchorFor(tool.name, agent),
						rawType: type,
						targetState: typeof tool.args.to === "string" ? tool.args.to : undefined,
						disposition: typeof tool.args.specialistDisposition === "string" ? tool.args.specialistDisposition : undefined,
						specialistAgentId: typeof tool.args.specialistAgentId === "string" ? tool.args.specialistAgentId : undefined,
						timestamp,
						callId: tool.callId,
						op: typeof tool.args.op === "string" ? tool.args.op : undefined,
						intent: tool.intent,
						detail: detailFor(tool.name, tool.args),
					});
				}
			} else if (type === "custom" && entry.customType === "tool_execution_start") {
				const data = asObject(entry.data);
				const name = typeof data.toolName === "string" ? data.toolName : "unknown";
				const args = asObject(data.args);
				const callId = typeof data.toolCallId === "string" ? data.toolCallId : undefined;
				push({
					sourceFile: relative,
					role: agent,
					status: "started",
					effect: effectFor(name),
					name,
					isLifecycleCompleted: false,
					isMessageOnly: false,
					etcLayer: layerFor(name, type),
					anchor: anchorFor(name, agent),
					rawType: "tool_execution_start",
					targetState: typeof args.to === "string" ? args.to : undefined,
					disposition: typeof args.specialistDisposition === "string" ? args.specialistDisposition : undefined,
					specialistAgentId: typeof args.specialistAgentId === "string" ? args.specialistAgentId : undefined,
					timestamp: typeof data.startedAt === "string" ? data.startedAt : timestamp,
					callId,
					op: typeof args.op === "string" ? args.op : undefined,
					intent: typeof data.intent === "string" ? data.intent : undefined,
					detail: detailFor(name, args),
				});
			} else if (type === "custom" && entry.customType === "session_exit") {
				const data = asObject(entry.data);
				const pending = Array.isArray(data.pendingToolCalls) ? data.pendingToolCalls : [];
				sessionExits.push({
					reason: typeof data.reason === "string" ? data.reason : undefined,
					at: typeof data.recordedAt === "string" ? data.recordedAt : timestamp,
					pendingCount: pending.length,
				});
				for (const item of pending) {
					const pendingCall = asObject(item);
					const args = asObject(pendingCall.args);
					pendingToolCalls.push({
						toolName: typeof pendingCall.toolName === "string" ? pendingCall.toolName : "unknown",
						callId: typeof pendingCall.toolCallId === "string" ? pendingCall.toolCallId : undefined,
						intent: typeof pendingCall.intent === "string" ? pendingCall.intent : undefined,
						op: typeof args.op === "string" ? args.op : undefined,
						startedAt: typeof pendingCall.startedAt === "string" ? pendingCall.startedAt : undefined,
					});
				}
			} else if (type === "model_change" && typeof entry.model === "string") {
				push({
					sourceFile: relative,
					role: agent,
					status: "success",
					effect: "none",
					name: "model_change",
					isLifecycleCompleted: false,
					isMessageOnly: false,
					etcLayer: "Governance",
					anchor: "config/model-roles.yml",
					model: entry.model,
					rawType: type,
					timestamp,
				});
			} else if (type === "session_init" || type === "task:subagent:lifecycle" || lifecycle) {
				const name = typeof entry.name === "string" ? entry.name : type;
				push({
					sourceFile: relative,
					role: agent,
					status: statusOf(type, lifecycle),
					effect: "none",
					name,
					isLifecycleCompleted: lifecycle === "completed" || type === "completed",
					isMessageOnly: false,
					etcLayer: "Lifecycle",
					anchor: anchorFor(name, agent),
					model: typeof entry.resolvedModel === "string" ? entry.resolvedModel : undefined,
					rawType: type,
					timestamp,
				});
			}
		}
	}

	const steps = [...byId.values(), ...anonymous]
		.sort((left, right) => (left.timestamp ?? "").localeCompare(right.timestamp ?? "") || left.id - right.id)
		.map((step, index) => ({ ...step, id: index + 1 }));

	let activeState: string | undefined;
	if (options.researchRoot) {
		try {
			const workflow = JSON.parse(await readFile(path.join(options.researchRoot, "workflow_state.json"), "utf8")) as JsonObject;
			activeState = typeof workflow.active_state === "string" ? workflow.active_state : undefined;
		} catch {
			// Outcome oracle reads state separately; missing file still yields a valid HTIR.
		}
	}

	return {
		schemaVersion: "1.0",
		researchRoot: options.researchRoot,
		activeState,
		steps,
		links: compileTraceLinks(steps),
		pendingToolCalls: pendingToolCalls.length > 0 ? pendingToolCalls : undefined,
		sessionExits: sessionExits.length > 0 ? sessionExits : undefined,
	};
}
