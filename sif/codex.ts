import { readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import { compileTraceLinks } from "./htir";
import { liveDiagnostics } from "./diagnostics";
import { elicitationRegression, scoreHtir } from "./scorecard";
import { ablationReport } from "./ablation";
import type { Htir, TraceEffect, TraceStatus, TraceStep } from "./types";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
	return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function parseJson(value: unknown): JsonObject {
	if (typeof value === "string") {
		try {
			return asObject(JSON.parse(value));
		} catch {
			return {};
		}
	}
	return asObject(value);
}

function commandFromExecInput(input: string): string {
	const json = parseJson(input);
	if (typeof json.cmd === "string") return json.cmd;
	const match = /exec_command\(\s*\{[\s\S]*?\bcmd\s*:\s*"((?:\\.|[^"\\])*)"/.exec(input);
	if (match?.[1]) return match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
	return input.slice(0, 240);
}

export async function resolveCodexRollout(input: string): Promise<string> {
	const resolved = path.resolve(input);
	const metadata = await stat(resolved);
	if (metadata.isFile()) return resolved;
	const transcript = path.join(resolved, "transcript.md");
	const text = await readFile(transcript, "utf8");
	const match = /Raw File:\s*`([^`]+)`/.exec(text);
	if (!match?.[1]) {
		throw new Error(`${resolved} is a forensics export without a Raw File jsonl pointer; SIF needs the Codex rollout, not tool-trace.md`);
	}
	return match[1];
}

export async function compileCodexRollout(file: string): Promise<Htir> {
	const text = await readFile(file, "utf8");
	const byId = new Map<string, TraceStep>();
	const anonymous: TraceStep[] = [];
	let nextId = 1;
	const push = (step: Omit<TraceStep, "id">, callId?: string) => {
		const record = { ...step, id: nextId, callId: callId ?? step.callId };
		if (callId && byId.has(callId)) {
			const existing = byId.get(callId)!;
			byId.set(callId, {
				...existing,
				...record,
				id: existing.id,
				isMessageOnly: existing.isMessageOnly && record.isMessageOnly,
				detail: record.detail ?? existing.detail,
				op: record.op ?? existing.op,
				status: record.status === "message" ? existing.status : record.status,
			});
			return;
		}
		nextId += 1;
		if (callId) byId.set(callId, record);
		else anonymous.push(record);
	};

	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		let entry: JsonObject;
		try {
			entry = asObject(JSON.parse(line));
		} catch {
			continue;
		}
		const payload = asObject(entry.payload);
		const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : undefined;
		const payloadType = typeof payload.type === "string" ? payload.type : "";
		if (entry.type === "response_item" && (payloadType === "custom_tool_call" || payloadType === "function_call")) {
			const name = typeof payload.name === "string" ? payload.name : "unknown";
			const callId = typeof payload.call_id === "string" ? payload.call_id : undefined;
			const args = parseJson(payload.arguments ?? payload.input);
			const input = typeof payload.input === "string" ? payload.input : "";
			const mapped = name === "exec" ? "bash" : name === "spawn_agent" ? "task" : name;
			const command = mapped === "bash" ? commandFromExecInput(input || JSON.stringify(args)) : undefined;
			const op = mapped === "wait"
				? (typeof args.cell_id === "string" ? "yield" : typeof args.timeoutMs === "number" ? "threads" : "unspecified")
				: undefined;
			const effect: TraceEffect = mapped === "bash" ? "read" : mapped === "task" ? "none" : "unknown";
			const status: TraceStatus = payload.status === "completed" ? "completed" : payload.status === "failed" ? "failure" : "started";
			push({
				sourceFile: path.basename(file),
				role: "M3",
				status,
				effect,
				name: mapped,
				isLifecycleCompleted: false,
				isMessageOnly: false,
				etcLayer: mapped === "task" ? "Lifecycle" : mapped === "wait" ? "Observability" : "Execution",
				anchor: "sif/codex.ts",
				rawType: payloadType,
				timestamp,
				callId,
				op,
				specialistAgentId: mapped === "task" && typeof args.task_name === "string" ? args.task_name : undefined,
				detail: command ?? (typeof payload.arguments === "string" ? payload.arguments.slice(0, 240) : undefined),
			}, callId);
			continue;
		}
		if (entry.type === "event_msg" && payloadType === "task_complete") {
			push({
				sourceFile: path.basename(file),
				role: "M3",
				status: "completed",
				effect: "none",
				name: "task:subagent:lifecycle",
				isLifecycleCompleted: true,
				isMessageOnly: false,
				etcLayer: "Lifecycle",
				anchor: "sif/codex.ts",
				rawType: payloadType,
				timestamp,
			});
		}
	}

	const steps = [...byId.values(), ...anonymous]
		.sort((left, right) => (left.timestamp ?? "").localeCompare(right.timestamp ?? "") || left.id - right.id)
		.map((step, index) => ({ ...step, id: index + 1 }));
	return {
		schemaVersion: "1.0",
		steps,
		links: compileTraceLinks(steps),
	};
}

export function scoreCodexTrace(htir: Htir) {
	const scorecard = scoreHtir(htir);
	const diagnostics = liveDiagnostics(htir);
	const processIssue = elicitationRegression(scorecard, { htir, inProgress: true });
	const ablation = ablationReport({
		outcomeReady: false,
		scorecard,
		diagnostics,
		processIssue,
	});
	const counts: Record<string, number> = {};
	for (const step of htir.steps) {
		const key = step.name ?? "unknown";
		counts[key] = (counts[key] ?? 0) + 1;
	}
	return {
		sif: "TRACE",
		kind: "codex-development",
		usableAsIphLiveIngest: false,
		reason: "Codex rollout has no workflow_state / iph_* tools; process gates still apply to spawn/wait/exec",
		toolCounts: counts,
		m3HubWait: diagnostics.m3HubWait,
		unboundedSearch: diagnostics.unboundedSearch.length,
		spawnedTasks: htir.steps.filter(step => step.name === "task").length,
		yieldWaits: htir.steps.filter(step => step.name === "wait" && step.op === "yield").length,
		processIssue,
		scorecard,
		ablation,
		stepCount: htir.steps.length,
	};
}

