import type { LedgerIndex, RoleLoop, RoleScorecard } from "./types";

export interface AcceptDecision {
	accept: boolean;
	reasons: string[];
}

function loopMap(scorecard: RoleScorecard | null | undefined): Map<string, RoleLoop> {
	return new Map((scorecard?.loops ?? []).map(loop => [loop.role, loop]));
}

function loopRegressed(before: RoleLoop, after: RoleLoop): string[] {
	const reasons: string[] = [];
	if (before.foundProblem && !after.foundProblem) reasons.push(`${before.role} lost problem discovery`);
	if (before.optimizedTask && !after.optimizedTask) reasons.push(`${before.role} lost task optimization`);
	if (before.finishedEfficiently && !after.finishedEfficiently) reasons.push(`${before.role} lost efficient finish`);
	return reasons;
}

export function heldOutRegressed(ledger: LedgerIndex, currentKey: string): boolean {
	const byKey = new Map<string, Array<{ kind: string; at: string }>>();
	for (const record of ledger.records) {
		if (record.reuseKey === currentKey) continue;
		const bucket = byKey.get(record.reuseKey) ?? [];
		bucket.push({ kind: record.kind, at: record.at });
		byKey.set(record.reuseKey, bucket);
	}
	for (const records of byKey.values()) {
		const sorted = [...records].sort((left, right) => left.at.localeCompare(right.at));
		let seenPass = false;
		for (const record of sorted) {
			if (record.kind === "PASS") seenPass = true;
			if (seenPass && record.kind === "FAIL") return true;
		}
	}
	return false;
}

export function regressionAwareAccept(options: {
	before?: RoleScorecard | null;
	after: RoleScorecard;
	targetGone: boolean;
	heldOutStillPass: boolean;
}): AcceptDecision {
	const reasons: string[] = [];
	if (!options.targetGone) reasons.push("target flaw still present");
	if (!options.heldOutStillPass) reasons.push("held-out reuseKey later failed");
	const before = loopMap(options.before);
	for (const after of options.after.loops) {
		const prior = before.get(after.role);
		if (prior) reasons.push(...loopRegressed(prior, after));
	}
	return { accept: reasons.length === 0, reasons };
}
