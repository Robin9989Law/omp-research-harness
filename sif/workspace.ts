import { spawnSync } from "node:child_process";
import { PROJECT_ROOT } from "./state";

export function gitOutput(args: string[], cwd = PROJECT_ROOT): string {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	return (result.stdout || "").trim();
}

export function workspaceSnapshot(cwd = PROJECT_ROOT): {
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
	const files = [...new Set([...changed, ...untracked])].sort();
	return { head, dirty: files.length > 0 || gitOutput(["status", "--porcelain"], cwd).length > 0, files };
}
