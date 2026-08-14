import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import {
	DELTA_CLASSES,
	FAILURE_CLASSES,
	LAYERS,
	NEXT_ACTIONS,
	OUTCOME_CLASSES,
	SCHEMA_VERSION,
	SCORECARD_SCHEMA,
	type DeltaClass,
	type IterationState,
	type PlanStep,
} from "./types";

export const SIF_ROOT = path.resolve(import.meta.dir);
export const PROJECT_ROOT = path.resolve(SIF_ROOT, "..");
export const STATE_FILE = path.join(SIF_ROOT, "iteration_state.json");
export const IMPACT_FILE = path.join(SIF_ROOT, "impact.yml");
export const LEDGER_FILE = path.join(SIF_ROOT, "evidence", "index.json");
export const RUNS_DIR = path.join(SIF_ROOT, "evidence", "runs");
export const IPH_LOCK_FILE = path.join(PROJECT_ROOT, "config", "iph-lock.json");

export function sha256(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

export function executionKey(planId: string, stepId: string, failureCode?: string): string {
	return `${planId}\0${stepId}\0${failureCode ?? "RUN"}`;
}

export function validateIterationState(value: unknown): string[] {
	const issues: string[] = [];
	if (!value || typeof value !== "object" || Array.isArray(value)) return ["iteration state must be an object"];
	const state = value as Record<string, unknown>;
	if (state.schemaVersion !== SCHEMA_VERSION) issues.push("schemaVersion must be 1.0");
	if (state.scorecardSchema !== SCORECARD_SCHEMA) issues.push("scorecardSchema must be role-scorecard.v1");
	if (typeof state.harnessHead !== "string" || !state.harnessHead) issues.push("harnessHead is required");
	if (typeof state.workingTreeDirty !== "boolean") issues.push("workingTreeDirty must be boolean");
	const lock = state.iphLock as Record<string, unknown> | undefined;
	if (!lock || !/^[0-9a-f]{40}$/.test(String(lock.commit ?? "")) || !/^[0-9a-f]{64}$/.test(String(lock.filesSha ?? ""))) {
		issues.push("iphLock.commit/filesSha are invalid");
	}
	const delta = state.delta as Record<string, unknown> | undefined;
	if (!delta || !Array.isArray(delta.files) || typeof delta.signature !== "string") issues.push("delta is invalid");
	else {
		const classes = Array.isArray(delta.classes) ? delta.classes : [];
		if (classes.some(item => !DELTA_CLASSES.includes(item as DeltaClass))) issues.push("delta.classes has unknown values");
	}
	if (typeof state.planId !== "string" || !state.planId) issues.push("planId is required");
	const steps = (state.plan as { steps?: unknown })?.steps;
	if (!Array.isArray(steps)) issues.push("plan.steps is required");
	else {
		for (const step of steps) {
			const item = step as PlanStep;
			if (!item?.id || !LAYERS.includes(item.layer) || !item.backend) issues.push(`invalid plan step ${item?.id ?? "?"}`);
		}
	}
	if (typeof state.currentStepIndex !== "number" || state.currentStepIndex < 0) issues.push("currentStepIndex is invalid");
	if (!NEXT_ACTIONS.includes(state.next_required_action as IterationState["next_required_action"])) {
		issues.push("next_required_action is invalid");
	}
	if (state.outcomeClass !== null && !OUTCOME_CLASSES.includes(state.outcomeClass as IterationState["outcomeClass"] & string)) {
		issues.push("outcomeClass is invalid");
	}
	if (!Array.isArray(state.executedKeys)) issues.push("executedKeys must be an array");
	if (state.stop) {
		const stop = state.stop as Record<string, unknown>;
		if (!FAILURE_CLASSES.includes(stop.failureClass as (typeof FAILURE_CLASSES)[number])) {
			issues.push("stop.failureClass is invalid");
		}
		const spec = stop.repairSpec as Record<string, unknown> | undefined;
		if (!spec?.operator || !spec.concern || !spec.evidence || !spec.suggestion) {
			issues.push("stop.repairSpec must include operator, concern, evidence, suggestion");
		}
	}
	return issues;
}

export function assertState(value: unknown): IterationState {
	const issues = validateIterationState(value);
	if (issues.length > 0) throw new Error(issues.join("\n"));
	return value as IterationState;
}

export async function loadState(file = STATE_FILE): Promise<IterationState | undefined> {
	try {
		return assertState(JSON.parse(await readFile(file, "utf8")));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

export async function saveState(state: IterationState, file = STATE_FILE): Promise<void> {
	assertState(state);
	await writeFile(file, `${JSON.stringify(state, null, 2)}\n`);
}

export function cannotRerun(state: IterationState, stepId: string, failureCode?: string): boolean {
	return state.executedKeys.includes(executionKey(state.planId, stepId, failureCode));
}

export function markExecuted(state: IterationState, stepId: string, failureCode?: string): void {
	const key = executionKey(state.planId, stepId, failureCode);
	if (!state.executedKeys.includes(key)) state.executedKeys.push(key);
}

export async function filesShaFromLock(lockFile = IPH_LOCK_FILE): Promise<{ commit: string; filesSha: string }> {
	const lock = JSON.parse(await readFile(lockFile, "utf8")) as { commit?: string; files?: Record<string, string> };
	const commit = String(lock.commit ?? "");
	const files = lock.files ?? {};
	const canonical = JSON.stringify(
		Object.fromEntries(Object.keys(files).sort().map(key => [key, files[key]])),
	);
	return { commit, filesSha: sha256(canonical) };
}
