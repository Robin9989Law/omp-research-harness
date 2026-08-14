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

export function consolidateFlaws(ledger: LedgerIndex): FlawRecord[] {
	const groups = new Map<string, FlawRecord>();
	for (const record of ledger.records) {
		if (record.kind !== "FAIL" && record.kind !== "REJECTED_EVOLUTION") continue;
		const failureClass = record.failureClass;
		if (!failureClass) continue;
		const operator = record.evolutionCandidate?.operator ?? "unspecified";
		const anchor = Object.keys(record.artifacts ?? {})[0] ?? record.step.backend;
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

export function attachFlawId(record: Pick<LedgerRecord, "failureClass" | "evolutionCandidate" | "artifacts" | "step">): string | undefined {
	if (!record.failureClass) return undefined;
	const operator = record.evolutionCandidate?.operator ?? "unspecified";
	const anchor = Object.keys(record.artifacts ?? {})[0] ?? record.step.backend;
	return `${record.failureClass}|${operator}|${anchor}`;
}
