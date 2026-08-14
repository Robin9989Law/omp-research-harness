import { spawnSync } from "node:child_process";
import { PROJECT_ROOT } from "./state";

export function gitOutput(args: string[], cwd = PROJECT_ROOT): string {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	return (result.stdout || "").trim();
}

export function committedDelta(base: string, cwd = PROJECT_ROOT): string[] {
	return gitOutput(["diff", "--name-only", `${base}...HEAD`], cwd)
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
