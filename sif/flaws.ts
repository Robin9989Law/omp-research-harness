import type { FailureClass, LedgerIndex, LedgerRecord } from "./types";

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

export function resolveFlawAnchor(
	record: Pick<LedgerRecord, "artifacts" | "step"> & {
		repairSpec?: { anchors?: string[] } | null;
		evolutionCandidate?: { operator?: string; targetFiles?: string[] } | null;
	},
): string {
	if (record.repairSpec?.anchors && record.repairSpec.anchors.length > 0 && record.repairSpec.anchors[0]) {
		return record.repairSpec.anchors[0];
	}
	if (record.evolutionCandidate?.targetFiles && record.evolutionCandidate.targetFiles.length > 0 && record.evolutionCandidate.targetFiles[0]) {
		return record.evolutionCandidate.targetFiles[0];
	}
	const artifactKeys = Object.keys(record.artifacts ?? {});
	const nonGeneric = artifactKeys.find(key => key !== "htir" && key !== "state" && key !== "workflow_state");
	if (nonGeneric) return nonGeneric;
	if (artifactKeys.length > 0 && artifactKeys[0]) return artifactKeys[0];
	return record.step?.backend ?? "unknown";
}

export function consolidateFlaws(ledger: LedgerIndex): FlawRecord[] {
	const groups = new Map<string, FlawRecord>();
	for (const record of ledger.records) {
		if (record.kind !== "FAIL" && record.kind !== "REJECTED_EVOLUTION") continue;
		const failureClass = record.failureClass;
		if (!failureClass) continue;
		const operator = record.evolutionCandidate?.operator ?? "unspecified";
		const anchor = resolveFlawAnchor(record);
		const id = `${failureClass}|${operator}|${anchor}`;
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
		repairSpec?: { anchors?: string[] } | null;
	},
): string | undefined {
	if (!record.failureClass) return undefined;
	const operator = record.evolutionCandidate?.operator ?? "unspecified";
	const anchor = resolveFlawAnchor(record);
	return `${record.failureClass}|${operator}|${anchor}`;
}
