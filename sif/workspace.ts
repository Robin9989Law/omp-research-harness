import { spawnSync } from "node:child_process";
import { impactSignature } from "./plan";
import { PROJECT_ROOT, sha256 } from "./state";
import type { ImpactResult } from "./types";

export function gitOutput(args: string[], cwd = PROJECT_ROOT): string {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	return (result.stdout || "").trim();
}

export function resolveGitBase(base: string, cwd = PROJECT_ROOT): string | undefined {
	if (gitOutput(["rev-parse", "--verify", "--quiet", base], cwd)) return base;
	const remote = `origin/${base.replace(/^origin\//, "")}`;
	if (gitOutput(["rev-parse", "--verify", "--quiet", remote], cwd)) return remote;
	return undefined;
}

export function committedDelta(base: string, cwd = PROJECT_ROOT): string[] {
	const resolved = resolveGitBase(base, cwd);
	if (!resolved) return [];
	return gitOutput(["diff", "--name-only", `${resolved}...HEAD`], cwd)
		.split("\n")
		.map(line => line.trim())
		.filter(Boolean);
}

export function workspaceSnapshot(cwd = PROJECT_ROOT, options?: { base?: string }): {
	head: string;
	dirty: boolean;
	files: string[];
} {
	const head = gitOutput(["rev-parse", "HEAD"], cwd) || "unknown";
	const changed = gitOutput(["diff", "--name-only", "HEAD"], cwd)
		.split("\n")
		.map(line => line.trim())
		.filter(Boolean);
	const untracked = gitOutput(["ls-files", "--others", "--exclude-standard"], cwd)
		.split("\n")
		.map(line => line.trim())
		.filter(Boolean);
	const committed = options?.base ? committedDelta(options.base, cwd) : [];
	const files = [...new Set([...changed, ...untracked, ...committed])].sort();
	const dirty = gitOutput(["status", "--porcelain"], cwd).length > 0;
	return { head, dirty, files };
}

export function workspaceContentSignature(files: string[], cwd = PROJECT_ROOT): string {
	const rows = files.map(relative => {
		const hashed = gitOutput(["hash-object", "--", relative], cwd);
		return `${relative}:${hashed || "missing"}`;
	});
	return sha256(rows.join("\n"));
}

export function evaluationSignature(impact: ImpactResult, files: string[], cwd = PROJECT_ROOT): string {
	return sha256(`${impactSignature(impact, files)}\n${workspaceContentSignature(files, cwd)}`);
}

export function defaultEvalBase(options?: {
	explicit?: string;
	envBase?: string;
	branch?: string;
	hasMain?: boolean;
}): string | undefined {
	if (options?.explicit?.trim()) return options.explicit.trim();
	if (options?.envBase?.trim()) return options.envBase.trim();
	const branch = options?.branch ?? gitOutput(["rev-parse", "--abbrev-ref", "HEAD"]);
	const hasMain = options?.hasMain ?? Boolean(gitOutput(["rev-parse", "--verify", "--quiet", "refs/heads/main"]));
	if (branch && branch !== "main" && hasMain) return "main";
	return undefined;
}

const SECRET_PATH = /(?:^|\/)(?:\.env(?:\..+)?|credentials(?:\..+)?|.*secrets.*|.*\.pem|id_rsa|id_ed25519)$/i;
const HARNESS_FILES = new Set([
	"CHANGELOG.md",
	"README.md",
	"SYSTEM.md",
	"SYSTEM_TEST_MATRIX.md",
	"AGENT_NATIVE_ENGINEERING.md",
	"package.json",
	"tsconfig.json",
	".gitignore",
]);
const HARNESS_PREFIXES = [
	"sif/",
	"extensions/",
	"agents/",
	"tests/",
	"scripts/",
	"commands/",
	"config/",
	"schemas/",
	"docs/",
	".github/",
	".cursor/rules/",
];

export function dirtyWorkingFiles(cwd = PROJECT_ROOT): string[] {
	const changed = gitOutput(["diff", "--name-only", "HEAD"], cwd)
		.split("\n")
		.map(line => line.trim())
		.filter(Boolean);
	const untracked = gitOutput(["ls-files", "--others", "--exclude-standard"], cwd)
		.split("\n")
		.map(line => line.trim())
		.filter(Boolean);
	return [...new Set([...changed, ...untracked])].sort();
}

export function classifyCommitFiles(files: string[]): { allowed: string[]; blocked: string[] } {
	const allowed: string[] = [];
	const blocked: string[] = [];
	for (const file of files) {
		const normalized = file.replaceAll("\\", "/");
		if (
			SECRET_PATH.test(normalized)
			|| normalized.includes("iteration_state.json")
			|| normalized.startsWith("sif/evidence/probes/")
			|| normalized.startsWith("sif/evidence/runs/")
		) {
			blocked.push(normalized);
			continue;
		}
		if (HARNESS_FILES.has(normalized) || HARNESS_PREFIXES.some(prefix => normalized.startsWith(prefix))) {
			allowed.push(normalized);
			continue;
		}
		blocked.push(normalized);
	}
	return { allowed, blocked };
}

export interface AutoCommitResult {
	ok: boolean;
	sha?: string;
	files: string[];
	issues: string[];
}

export function autoCommitHarness(options?: {
	cwd?: string;
	files?: string[];
	message?: string;
	exec?: (args: string[]) => { ok: boolean; output: string; stderr?: string };
}): AutoCommitResult {
	const cwd = options?.cwd ?? PROJECT_ROOT;
	const run = options?.exec ?? ((args: string[]) => {
		const result = spawnSync("git", args, { cwd, encoding: "utf8" });
		return {
			ok: result.status === 0,
			output: (result.stdout || "").trim(),
			stderr: (result.stderr || "").trim(),
		};
	});
	const { allowed, blocked } = classifyCommitFiles(options?.files ?? dirtyWorkingFiles(cwd));
	if (allowed.length === 0) {
		return {
			ok: false,
			files: [],
			issues: blocked.length > 0
				? [`left unstaged: ${blocked.join(", ")}`]
				: ["no dirty harness files to commit"],
		};
	}
	const added = run(["add", "--", ...allowed]);
	if (!added.ok) {
		return { ok: false, files: allowed, issues: [added.stderr || added.output || "git add failed"] };
	}
	const message = options?.message ?? [
		"sif: snapshot probe-clear harness delta",
		"",
		"Auto-commit so certify can run on a clean tree.",
	].join("\n");
	const committed = run(["commit", "-m", message]);
	if (!committed.ok) {
		return { ok: false, files: allowed, issues: [committed.stderr || committed.output || "git commit failed"] };
	}
	const sha = run(["rev-parse", "HEAD"]).output;
	if (blocked.length > 0) {
		return {
			ok: false,
			sha,
			files: allowed,
			issues: [`left unstaged: ${blocked.join(", ")}`],
		};
	}
	return { ok: true, sha, files: allowed, issues: [] };
}
