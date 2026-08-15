import type { RepairSpec } from "./types";

export function cesComplete(spec: Pick<RepairSpec, "concern" | "evidence" | "suggestion">): string[] {
	const issues: string[] = [];
	if (!spec.concern?.trim()) issues.push("CES missing concern");
	if (!spec.evidence?.trim()) issues.push("CES missing evidence");
	if (!spec.suggestion?.trim()) issues.push("CES missing suggestion");
	return issues;
}

/** HarnessBridge: no evidence → Pass; a named issue is a refuse. */
export function defaultPassWhenNoEvidence(issue: string | undefined | null): "pass" | "reject" {
	return issue && issue.trim().length > 0 ? "reject" : "pass";
}

export interface WriteAheadAudit {
	beforeMutation: number;
	unevidenced: string[];
}

/**
 * Write-ahead refuses in iph.ts must interpolate a named checker (evidence).
 * A bare "rejected before mutation" with no `${issue}` is a CES violation.
 */
export function auditWriteAheadRejects(source: string): WriteAheadAudit {
	const unevidenced: string[] = [];
	const beforeMutation = [...source.matchAll(/rejected before mutation:/g)].length;
	for (const match of source.matchAll(/rejected before mutation:([^\n`]+)/g)) {
		const rest = match[1] ?? "";
		if (!/\$\{[A-Za-z][A-Za-z0-9]*\}/.test(rest)) {
			unevidenced.push(rest.trim() || "rejected before mutation with no evidence interpolation");
		}
	}
	return { beforeMutation, unevidenced };
}
