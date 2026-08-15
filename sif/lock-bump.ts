import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { POSITIVE_STATE_SEQUENCE } from "../extensions/iph";
import { IPH_LOCK_FILE, PROJECT_ROOT, RUNS_DIR } from "./state";

export async function hashFiles(root: string, relatives: string[]): Promise<Record<string, string>> {
	const files: Record<string, string> = {};
	for (const relative of relatives.sort()) {
		const bytes = await readFile(path.join(root, relative));
		files[relative] = createHash("sha256").update(bytes).digest("hex");
	}
	return files;
}

export async function currentLockRelatives(lockFile = IPH_LOCK_FILE): Promise<{
	commit: string;
	repository: string;
	relatives: string[];
}> {
	const lock = JSON.parse(await readFile(lockFile, "utf8")) as {
		commit: string;
		repository: string;
		files: Record<string, string>;
	};
	return { commit: lock.commit, repository: lock.repository, relatives: Object.keys(lock.files).sort() };
}

export async function probePythonStates(skillDir: string): Promise<string[]> {
	const child = Bun.spawn([
		process.env.IPH_PYTHON || "python3",
		"-c",
		"import json,sys; sys.path.insert(0,sys.argv[1]); import validate_workflow_state as v; print(json.dumps(sorted(v.STATES)))",
		path.join(skillDir, "scripts"),
	], { stdout: "pipe", stderr: "pipe" });
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (exitCode !== 0) throw new Error(`cannot read Python STATES: ${stderr.trim()}`);
	return JSON.parse(stdout) as string[];
}

export function statesMatch(pythonStates: string[]): string[] {
	const harness = [...POSITIVE_STATE_SEQUENCE, "BLOCKED"].sort();
	const python = [...pythonStates].sort();
	if (JSON.stringify(harness) !== JSON.stringify(python)) {
		return [`Python/TypeScript state drift: python=${JSON.stringify(python)} harness=${JSON.stringify(harness)}`];
	}
	return [];
}

export async function writeCandidateLock(options: {
	commit: string;
	repository: string;
	files: Record<string, string>;
	runDir: string;
}): Promise<string> {
	const candidate = {
		schema_version: "1.0",
		repository: options.repository,
		commit: options.commit,
		files: options.files,
	};
	const file = path.join(options.runDir, "iph-lock.candidate.json");
	await mkdir(options.runDir, { recursive: true });
	await writeFile(file, `${JSON.stringify(candidate, null, 2)}\n`);
	return file;
}

export async function lockBump(options: {
	commit: string;
	dryRun?: boolean;
	repository?: string;
}): Promise<{
	candidatePath?: string;
	files: Record<string, string>;
	pytestExit?: number;
	stateIssues: string[];
	fixtureRegenRequired: boolean;
	output: string;
}> {
	if (!/^[0-9a-f]{40}$/.test(options.commit)) throw new Error("lock-bump requires a 40-character commit");
	const current = await currentLockRelatives();
	const repository = options.repository ?? current.repository;
	if (options.dryRun) {
		return {
			files: {},
			stateIssues: [],
			fixtureRegenRequired: false,
			output: `sif_lock_bump=DRY_RUN commit=${options.commit} repository=${repository} files=${current.relatives.length}\n`,
		};
	}
	const work = await mkdtemp(path.join(tmpdir(), "sif-iph-lock-"));
	try {
		const clone = Bun.spawn([
			"git", "clone", "--filter=blob:none", repository, path.join(work, "iph"),
		], { cwd: PROJECT_ROOT, stdout: "pipe", stderr: "pipe" });
		const cloneExit = await clone.exited;
		const cloneErr = await new Response(clone.stderr).text();
		if (cloneExit !== 0) throw new Error(`git clone failed: ${cloneErr}`);
		const checkout = Bun.spawn([
			"git", "-C", path.join(work, "iph"), "checkout", "--detach", options.commit,
		], { stdout: "pipe", stderr: "pipe" });
		const checkoutExit = await checkout.exited;
		if (checkoutExit !== 0) throw new Error(`git checkout failed: ${await new Response(checkout.stderr).text()}`);
		const skillDir = path.join(work, "iph");
		const files = await hashFiles(skillDir, current.relatives);
		const pythonStates = await probePythonStates(skillDir);
		const stateIssues = statesMatch(pythonStates);
		const pytest = Bun.spawn(
			[process.env.IPH_PYTHON || "python3", "-m", "pytest", path.join(skillDir, "tests"), "-q"],
			{ stdout: "pipe", stderr: "pipe" },
		);
		const [pytestExit, pytestOut, pytestErr] = await Promise.all([
			pytest.exited,
			new Response(pytest.stdout).text(),
			new Response(pytest.stderr).text(),
		]);
		const runDir = path.join(RUNS_DIR, `lock-bump-${options.commit.slice(0, 12)}`);
		const candidatePath = await writeCandidateLock({ commit: options.commit, repository, files, runDir });
		return {
			candidatePath,
			files,
			pytestExit,
			stateIssues,
			fixtureRegenRequired: stateIssues.length > 0,
			output: [
				`sif_lock_bump=${pytestExit === 0 && stateIssues.length === 0 ? "READY" : "FAIL"}`,
				`commit=${options.commit}`,
				`candidate=${candidatePath}`,
				`pytest=${pytestExit}`,
				stateIssues.join("\n"),
				pytestOut,
				pytestErr,
			].filter(Boolean).join("\n"),
		};
	} finally {
		await rm(work, { recursive: true, force: true });
	}
}
