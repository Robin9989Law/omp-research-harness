import { spawnSync } from "node:child_process";
import { heldOutRegressed } from "./accept";
import { loadLedger, pendingEvolution } from "./ledger";
import { filesShaFromLock, loadState, PROJECT_ROOT } from "./state";
import type { IterationState, LedgerIndex } from "./types";

export function independentIsolatedPasses(ledger: LedgerIndex): number {
	return ledger.records
		.filter(record => record.step.layer === "L5" && record.step.backend === "real-model-nodes" && record.kind === "PASS")
		.reduce((sum, record) => sum + (record.isolatedTrials && record.isolatedTrials > 0 ? record.isolatedTrials : 1), 0);
}

export interface CertifyResult {
	ok: boolean;
	action: "DONE" | "REPAIR" | "RUN_STEP";
	issues: string[];
}

function gitPorcelain(cwd = PROJECT_ROOT): string {
	return spawnSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" }).stdout.trim();
}

export async function certify(options?: {
	state?: IterationState;
	allowDirty?: boolean;
	requireRealModels?: boolean;
	dirtyPorcelain?: string;
	ledger?: LedgerIndex;
}): Promise<CertifyResult> {
	const issues: string[] = [];
	const dirty = options?.dirtyPorcelain ?? gitPorcelain();
	if (dirty && !options?.allowDirty) issues.push(`working tree is dirty; certify requires a clean tree\n${dirty}`);

	const ledger = options?.ledger ?? await loadLedger();
	const state = options?.state ?? await loadState();
	if (!state) issues.push("no iteration_state.json; run iterate first");
	else {
		if (state.next_required_action === "REPAIR" || state.next_required_action === "REPLAY") {
			issues.push(`cannot certify while ${state.next_required_action} is required`);
		}
		if (state.outcomeClass === "failed") issues.push("outcomeClass=failed");
		if (state.outcomeClass === "unverified_success") {
			issues.push("unverified_success: outcome passed without find→optimize→finish evidence");
		}
		if (state.outcomeClass === "assisted_verified_success") {
			issues.push("assisted_verified_success: autonomy gap; human/sigterm intervention was required");
		}
		if (state.outcomeClass === "unsafe_invalid") {
			issues.push("unsafe_invalid: skip-axes, unbounded search, or other task bypass");
		}
		if (state.workingTreeDirty && !options?.allowDirty) issues.push("iteration state still marked dirty");
		const lock = await filesShaFromLock();
		if (lock.commit !== state.iphLock.commit || lock.filesSha !== state.iphLock.filesSha) {
			issues.push("iph lock identity drifted from iteration state");
		}
		if (options?.requireRealModels && state.deferred?.includes("L5")) {
			const live = ledger.records.some(record => record.step.backend === "live-continuous" && record.kind === "PASS");
			const isolated = independentIsolatedPasses(ledger);
			if (!live && isolated < (state.passK ?? 2)) {
				issues.push(`L5 real-model pass^k evidence is still deferred (need live-continuous PASS or ${state.passK ?? 2} independent isolated trials; have ${isolated})`);
			}
		}
		if (state.deferred?.includes("L6") && state.delta.classes.includes("prompt")) {
			const ablationPass = ledger.records.some(record => record.step.layer === "L6" && record.kind === "PASS");
			if (!ablationPass) issues.push("L6 ablation still deferred for a prompt/scaffold change");
		}
	}

	const pending = pendingEvolution(ledger);
	if (pending.length > 0) {
		issues.push(`unhandled deleteScaffold candidates: ${pending.map(item => item.id).join(", ")}`);
	}
	if (heldOutRegressed(ledger, "")) {
		issues.push("held-out reuseKey later failed; regression-aware accept would reject");
	}

	return {
		ok: issues.length === 0,
		action: issues.length === 0 ? "DONE" : issues.some(issue => issue.includes("REPAIR") || issue.includes("unverified")) ? "REPAIR" : "RUN_STEP",
		issues,
	};
}
