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

function recordTime(at: string): number {
	const ms = Date.parse(at);
	return Number.isFinite(ms) ? ms : Number.NaN;
}

function latestIsRegression(record: { kind: string; failureClass?: string | null }): boolean {
	if (record.kind === "FAIL" || record.kind === "REJECTED_EVOLUTION") return true;
	return record.kind === "REPLAY" && Boolean(record.failureClass);
}

export function heldOutRegressed(ledger: LedgerIndex, currentKey: string): boolean {
	const byKey = new Map<string, Array<{ kind: string; at: string; failureClass?: string | null }>>();
	for (const record of ledger.records) {
		if (record.reuseKey === currentKey) continue;
		const bucket = byKey.get(record.reuseKey) ?? [];
		bucket.push({ kind: record.kind, at: record.at, failureClass: record.failureClass });
		byKey.set(record.reuseKey, bucket);
	}
	for (const records of byKey.values()) {
		const sorted = [...records].sort((left, right) => {
			const leftMs = recordTime(left.at);
			const rightMs = recordTime(right.at);
			if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) return leftMs - rightMs;
			return left.at.localeCompare(right.at);
		});
		const hadPass = sorted.some(record => record.kind === "PASS");
		const latest = sorted[sorted.length - 1];
		if (hadPass && latest && latestIsRegression(latest)) return true;
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
