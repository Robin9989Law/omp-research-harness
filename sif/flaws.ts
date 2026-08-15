import type { FailureClass, LedgerIndex, LedgerRecord, RepairSpec } from "./types";

export interface FlawRecord {
	id: string;
	failureClass: FailureClass;
	operator: string;
	anchor: string;
	count: number;
	firstFailId: string;
	lastFailId: string;
	lastAt: string;
}

export const GENERIC_ARTIFACT_KEYS = new Set(["htir", "state", "workflow_state", "log"]);

export function resolveFlawAnchor(
	record: Pick<LedgerRecord, "artifacts" | "step"> & {
		repairSpec?: Pick<RepairSpec, "anchors"> | null;
		evolutionCandidate?: { operator?: string; targetFiles?: string[] } | null;
		flawId?: string | null;
	},
): string {
	if (record.repairSpec?.anchors && record.repairSpec.anchors.length > 0 && record.repairSpec.anchors[0]) {
		return record.repairSpec.anchors[0];
	}
	if (record.evolutionCandidate?.targetFiles && record.evolutionCandidate.targetFiles.length > 0 && record.evolutionCandidate.targetFiles[0]) {
		return record.evolutionCandidate.targetFiles[0];
	}
	if (record.flawId) {
		const parts = record.flawId.split("|");
		if (parts[2] && parts[2] !== "htir") return parts[2];
	}
	const artifactKeys = Object.keys(record.artifacts ?? {});
	const nonGeneric = artifactKeys.find(key => !GENERIC_ARTIFACT_KEYS.has(key));
	if (nonGeneric) return nonGeneric;
	return record.step?.backend ?? "unknown";
}

export function evolutionFromRepair(
	repairSpec: Pick<RepairSpec, "operator" | "anchors">,
	options?: { deleteScaffold?: boolean },
): NonNullable<LedgerRecord["evolutionCandidate"]> {
	return {
		operator: repairSpec.operator,
		deleteScaffold: options?.deleteScaffold,
		targetFiles: repairSpec.anchors,
	};
}

export function consolidateFlaws(ledger: LedgerIndex): FlawRecord[] {
	const groups = new Map<string, FlawRecord>();
	for (const record of ledger.records) {
		if (record.kind !== "FAIL" && record.kind !== "REJECTED_EVOLUTION") continue;
		const failureClass = record.failureClass;
		if (!failureClass) continue;
		const operator = record.evolutionCandidate?.operator ?? "unspecified";
		const anchor = resolveFlawAnchor(record);
		const id = record.flawId ?? `${failureClass}|${operator}|${anchor}`;
		const existing = groups.get(id);
		if (!existing) {
			groups.set(id, {
				id,
				failureClass,
				operator,
				anchor,
				count: 1,
				firstFailId: record.id,
				lastFailId: record.id,
				lastAt: record.at,
			});
			continue;
		}
		existing.count += 1;
		existing.lastFailId = record.id;
		existing.lastAt = record.at;
	}
	return [...groups.values()].sort((left, right) => right.count - left.count || left.id.localeCompare(right.id));
}

export function attachFlawId(
	record: Pick<LedgerRecord, "failureClass" | "evolutionCandidate" | "artifacts" | "step"> & {
		repairSpec?: Pick<RepairSpec, "anchors"> | null;
		flawId?: string | null;
	},
): string | undefined {
	if (!record.failureClass) return undefined;
	const operator = record.evolutionCandidate?.operator ?? "unspecified";
	const anchor = resolveFlawAnchor(record);
	return `${record.failureClass}|${operator}|${anchor}`;
}
