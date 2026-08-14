import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { LEDGER_FILE, sha256 } from "./state";
import type { IphLockIdentity, Layer, LedgerIndex, LedgerRecord } from "./types";
import { SCORECARD_SCHEMA } from "./types";

export function reuseKey(options: {
	iphLock: IphLockIdentity;
	fixtureHash?: string;
	layer: Layer;
	node?: number | null;
	harnessContractHash: string;
}): string {
	return [
		options.iphLock.commit,
		options.iphLock.filesSha,
		options.fixtureHash ?? "none",
		options.layer,
		options.node ?? "na",
		options.harnessContractHash,
		SCORECARD_SCHEMA,
	].join("|");
}

export async function loadLedger(file = LEDGER_FILE): Promise<LedgerIndex> {
	try {
		const parsed = JSON.parse(await readFile(file, "utf8")) as LedgerIndex;
		if (!parsed || parsed.schemaVersion !== "1.0" || !Array.isArray(parsed.records)) {
			throw new Error("evidence/index.json is not a SIF ledger");
		}
		return parsed;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: "1.0", records: [] };
		throw error;
	}
}

export async function saveLedger(index: LedgerIndex, file = LEDGER_FILE): Promise<void> {
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, `${JSON.stringify(index, null, 2)}\n`);
}

export function findReusablePass(index: LedgerIndex, key: string): LedgerRecord | undefined {
	return [...index.records].reverse().find(record => record.reuseKey === key && record.kind === "PASS");
}

export function firstFailFor(index: LedgerIndex, key: string): LedgerRecord | undefined {
	return index.records.find(record => record.reuseKey === key && record.kind === "FAIL");
}

export async function appendLedger(record: Omit<LedgerRecord, "id" | "at"> & { id?: string; at?: string }, file = LEDGER_FILE): Promise<LedgerRecord> {
	const index = await loadLedger(file);
	if (record.id) {
		const existing = index.records.find(item => item.id === record.id);
		if (existing) throw new Error(`ledger refuses to mutate existing record ${record.id}`);
	}
	if (record.kind === "PASS") {
		const priorFail = firstFailFor(index, record.reuseKey);
		if (priorFail && record.firstFailId !== priorFail.id && !record.firstFailId) {
			record = { ...record, firstFailId: priorFail.id };
		}
	}
	const written: LedgerRecord = {
		...record,
		id: record.id ?? randomUUID(),
		at: record.at ?? new Date().toISOString(),
	};
	index.records.push(written);
	await saveLedger(index, file);
	return written;
}

export function artifactHash(contents: string): string {
	return sha256(contents);
}

export function pendingEvolution(index: LedgerIndex): LedgerRecord[] {
	return index.records.filter(record => record.kind !== "PASS" && record.evolutionCandidate?.deleteScaffold);
}
