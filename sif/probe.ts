import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { classifyFiles, loadImpactSurfaces } from "./impact";
import { ingestLiveRun, type IngestReport } from "./ingest";
import { attachFlawId, evolutionFromRepair } from "./flaws";
import { attributeFailure } from "./repair";
import { cesComplete } from "./ces";
import {
	PROBE_DIR,
	PROBE_LATEST_FILE,
	PROBE_LOG_FILE,
	PROJECT_ROOT,
} from "./state";
import type { FailureClass, ImpactResult, Layer, RepairSpec } from "./types";
import { LAYERS } from "./types";
import { evaluationSignature, workspaceSnapshot } from "./workspace";

export const PROBE_ORACLES = ["typecheck", "system-matrix", "bun-test", "omp-e2e", "snapshot"] as const;
export type ProbeOracle = (typeof PROBE_ORACLES)[number];
export type ProbeStatus = "HIT" | "CLEAR" | "STALE";

export interface ProbeCard {
	sif: "PROBE";
	kind: "OBSERVE";
	status: ProbeStatus;
	at: string;
	oracle: ProbeOracle | "none";
	oraclesRun: ProbeOracle[];
	deltaSignature: string;
	files: string[];
	certify: false;
	injectIntoResearchSession: false;
	flawId?: string | null;
	failureClass?: FailureClass | null;
	repairSpec?: RepairSpec | null;
	anchors?: string[];
	concern?: string;
	evidence?: string;
	suggestion?: string;
	reference: string;
	emptyDelta?: boolean;
}

export interface OracleResult {
	ok: boolean;
	output: string;
	exitCode: number;
}

const ORACLE_COMMANDS: Record<Exclude<ProbeOracle, "snapshot">, string[][]> = {
	typecheck: [["bun", "run", "typecheck"]],
	"system-matrix": [["bun", "run", "test:system"]],
	"bun-test": [["bun", "test"]],
	"omp-e2e": [["bun", "run", "test:omp"]],
};

export function probeOraclesForImpact(impact: ImpactResult): Exclude<ProbeOracle, "snapshot">[] {
	const oracles: Exclude<ProbeOracle, "snapshot">[] = [];
	if (impact.layers.includes("L0")) {
		oracles.push("typecheck");
		oracles.push("system-matrix");
	}
	if (impact.layers.includes("L1")) oracles.push("bun-test");
	if (impact.layers.includes("L2") || impact.layers.includes("L3")) oracles.push("omp-e2e");
	return oracles;
}

export function layersFromRepairSpec(spec: Pick<RepairSpec, "regressionSet"> | null | undefined): Layer[] {
	if (!spec) return [];
	return spec.regressionSet.filter((item): item is Layer => (LAYERS as readonly string[]).includes(item));
}

export function extraLayersFromProbe(card: ProbeCard | undefined): Layer[] {
	if (card?.status !== "HIT") return [];
	return layersFromRepairSpec(card.repairSpec);
}

export async function extraLayersFromLastHit(logFile = PROBE_LOG_FILE): Promise<Layer[]> {
	try {
		const lines = (await readFile(logFile, "utf8")).trim().split("\n").reverse();
		for (const line of lines) {
			if (!line.trim()) continue;
			const card = JSON.parse(line) as ProbeCard;
			if (card.status === "HIT" && card.repairSpec) return layersFromRepairSpec(card.repairSpec);
		}
		return [];
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

export function anchorsFromOracleOutput(output: string, fallback: string[]): string[] {
	const hits = [...output.matchAll(/\b((?:extensions|sif|agents|tests|scripts|commands)\/[\w./-]+\.(?:ts|md|yml))/g)]
		.map(match => match[1])
		.filter((item): item is string => Boolean(item));
	const unique = [...new Set(hits)];
	return unique.length > 0 ? unique.slice(0, 4) : fallback;
}

export function staleProbeCard(previous: ProbeCard, currentSignature: string, files: string[]): ProbeCard | undefined {
	if (previous.deltaSignature === currentSignature) return undefined;
	return {
		...previous,
		status: "STALE",
		at: new Date().toISOString(),
		files,
		deltaSignature: currentSignature,
		certify: false,
		injectIntoResearchSession: false,
		reference: "Delta changed; previous probe advice is stale until oracles rerun.",
	};
}

export function snapshotProbeHit(report: Pick<IngestReport, "processIssue" | "diagnostics">): {
	hit: boolean;
	failureClass?: FailureClass;
	message: string;
} {
	if (report.processIssue) {
		return { hit: true, failureClass: "ELICITATION_REGRESSION", message: report.processIssue };
	}
	const projection = report.diagnostics?.projection;
	if (projection && !projection.ok) {
		return { hit: true, failureClass: "CONTRACT_FAIL", message: projection.issue ?? "observation projection failed" };
	}
	if (report.diagnostics?.shortHubIdle) {
		return { hit: true, failureClass: "EFFICIENCY_REGRESSION", message: "short hub wait idle" };
	}
	if ((report.diagnostics?.m3HubWait ?? 0) > 0) {
		return { hit: true, failureClass: "ELICITATION_REGRESSION", message: `M3 hub wait ${report.diagnostics?.m3HubWait}` };
	}
	if ((report.diagnostics?.unboundedSearch.length ?? 0) > 0) {
		return { hit: true, failureClass: "EFFICIENCY_REGRESSION", message: "unbounded search" };
	}
	return { hit: false, message: "snapshot clear" };
}

function tunerReference(spec: RepairSpec): string {
	const missing = cesComplete(spec);
	if (missing.length > 0) return missing.join("; ");
	return `${spec.operator} @ ${spec.anchors.join(", ")}: ${spec.suggestion}`;
}

function cardFromSpec(options: {
	status: ProbeStatus;
	oracle: ProbeOracle | "none";
	oraclesRun: ProbeOracle[];
	deltaSignature: string;
	files: string[];
	repairSpec?: RepairSpec;
	failureClass?: FailureClass;
	emptyDelta?: boolean;
}): ProbeCard {
	const spec = options.repairSpec;
	const evolution = spec ? evolutionFromRepair(spec) : undefined;
	const flawId = options.failureClass && spec
		? attachFlawId({
			failureClass: options.failureClass,
			evolutionCandidate: evolution,
			artifacts: {},
			step: { layer: "L0", node: null, backend: options.oracle === "none" ? "probe" : options.oracle },
			repairSpec: spec,
		})
		: undefined;
	return {
		sif: "PROBE",
		kind: "OBSERVE",
		status: options.status,
		at: new Date().toISOString(),
		oracle: options.oracle,
		oraclesRun: options.oraclesRun,
		deltaSignature: options.deltaSignature,
		files: options.files,
		certify: false,
		injectIntoResearchSession: false,
		flawId: flawId ?? null,
		failureClass: options.failureClass ?? null,
		repairSpec: spec ?? null,
		anchors: spec?.anchors,
		concern: spec?.concern,
		evidence: spec?.evidence,
		suggestion: spec?.suggestion,
		emptyDelta: options.emptyDelta,
		reference: spec
			? tunerReference(spec)
			: options.emptyDelta
				? "No harness delta against the evaluation base. Wait for a local change, or pass --base explicitly."
				: options.status === "CLEAR"
					? "Cheapest matching oracles are clear. Keep tuning; run full iterate after the tree is stable."
					: "Probe observation only. Not a certify result.",
	};
}

export async function defaultExecOracle(oracle: Exclude<ProbeOracle, "snapshot">, cwd = PROJECT_ROOT): Promise<OracleResult> {
	let output = "";
	for (const command of ORACLE_COMMANDS[oracle]) {
		const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		output += `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}`;
		if (exitCode !== 0) return { ok: false, output, exitCode };
	}
	return { ok: true, output, exitCode: 0 };
}

export async function loadLatestProbe(file = PROBE_LATEST_FILE): Promise<ProbeCard | undefined> {
	try {
		const parsed = JSON.parse(await readFile(file, "utf8")) as ProbeCard;
		if (parsed?.sif !== "PROBE" || parsed.kind !== "OBSERVE") return undefined;
		return parsed;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

export async function writeProbeCard(card: ProbeCard, options?: {
	latestFile?: string;
	logFile?: string;
}): Promise<ProbeCard> {
	const latestFile = options?.latestFile ?? PROBE_LATEST_FILE;
	const logFile = options?.logFile ?? PROBE_LOG_FILE;
	await mkdir(path.dirname(latestFile), { recursive: true });
	await writeFile(latestFile, `${JSON.stringify(card, null, 2)}\n`);
	await mkdir(path.dirname(logFile), { recursive: true });
	await appendFile(logFile, `${JSON.stringify(card)}\n`);
	return card;
}

export async function runProbe(options?: {
	base?: string;
	cwd?: string;
	files?: string[];
	researchRoot?: string;
	force?: boolean;
	execOracle?: (oracle: Exclude<ProbeOracle, "snapshot">) => Promise<OracleResult>;
	snapshot?: (researchRoot: string) => Promise<IngestReport>;
	latestFile?: string;
	logFile?: string;
}): Promise<ProbeCard> {
	const cwd = options?.cwd ?? PROJECT_ROOT;
	if (options?.researchRoot) {
		const resolved = path.resolve(options.researchRoot);
		if (resolved === path.resolve(cwd) || resolved === path.resolve(PROJECT_ROOT)) {
			throw new Error("research-root must not be the harness checkout; pass a live-run snapshot directory.");
		}
	}
	const files = options?.files ?? workspaceSnapshot(cwd, { base: options?.base }).files;
	const surfaces = await loadImpactSurfaces();
	const impact = classifyFiles(files, surfaces);
	const signature = evaluationSignature(impact, files, cwd);
	const previous = await loadLatestProbe(options?.latestFile);
	if (previous && previous.deltaSignature === signature && previous.status !== "STALE" && !options?.force) {
		return previous;
	}
	if (previous && previous.deltaSignature !== signature) {
		await writeProbeCard(staleProbeCard(previous, signature, files)!, {
			latestFile: options?.latestFile,
			logFile: options?.logFile,
		});
	}

	if (files.length === 0) {
		return writeProbeCard(cardFromSpec({
			status: "CLEAR",
			oracle: "none",
			oraclesRun: [],
			deltaSignature: signature,
			files,
			emptyDelta: true,
		}), { latestFile: options?.latestFile, logFile: options?.logFile });
	}

	const oracles = probeOraclesForImpact(impact);
	const execOracle = options?.execOracle ?? (oracle => defaultExecOracle(oracle, cwd));
	const ran: ProbeOracle[] = [];
	const anchorsFromDelta = files.filter(file => (
		file.startsWith("extensions/")
		|| file.startsWith("agents/")
		|| file === "SYSTEM.md"
	)).slice(0, 4);

	for (const oracle of oracles) {
		ran.push(oracle);
		const result = await execOracle(oracle);
		if (result.ok) continue;
		const failureClass: FailureClass = result.output.includes("deadlock") || result.output.includes("EFFICIENCY")
			? "EFFICIENCY_REGRESSION"
			: "CONTRACT_FAIL";
		const repairSpec = attributeFailure({
			failureClass,
			message: result.output.slice(-2000),
			anchors: anchorsFromOracleOutput(result.output, anchorsFromDelta),
		});
		return writeProbeCard(cardFromSpec({
			status: "HIT",
			oracle,
			oraclesRun: ran,
			deltaSignature: signature,
			files,
			repairSpec,
			failureClass,
		}), { latestFile: options?.latestFile, logFile: options?.logFile });
	}

	if (options?.researchRoot) {
		ran.push("snapshot");
		const report = await (options.snapshot ?? ((root: string) => ingestLiveRun({
			researchRoot: root,
			snapshot: true,
			writeLedger: false,
			runsDir: path.join(PROBE_DIR, "runs"),
		})))(options.researchRoot);
		const hit = snapshotProbeHit(report);
		if (hit.hit && hit.failureClass) {
			const repairSpec = attributeFailure({
				failureClass: hit.failureClass,
				message: hit.message,
				anchors: anchorsFromDelta.length > 0 ? anchorsFromDelta : undefined,
			});
			return writeProbeCard(cardFromSpec({
				status: "HIT",
				oracle: "snapshot",
				oraclesRun: ran,
				deltaSignature: signature,
				files,
				repairSpec,
				failureClass: hit.failureClass,
			}), { latestFile: options?.latestFile, logFile: options?.logFile });
		}
	}

	return writeProbeCard(cardFromSpec({
		status: "CLEAR",
		oracle: ran[ran.length - 1] ?? "none",
		oraclesRun: ran,
		deltaSignature: signature,
		files,
	}), { latestFile: options?.latestFile, logFile: options?.logFile });
}
