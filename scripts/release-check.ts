import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

async function run(command: string[], cwd: string, env: Record<string, string> = {}): Promise<void> {
	const child = Bun.spawn(command, {
		cwd,
		stdout: "inherit",
		stderr: "inherit",
		env: { ...process.env, ...env },
	});
	const exitCode = await child.exited;
	if (exitCode !== 0) throw new Error(`${command.join(" ")} failed with exit ${exitCode}`);
}

const projectRoot = path.resolve(import.meta.dir, "..");
const root = await mkdtemp(path.join(tmpdir(), "research-harness-release-check-"));
try {
	const npmCache = path.join(root, "npm-cache");
	await run(["npm", "pack", "--dry-run", "--json"], projectRoot, { npm_config_cache: npmCache });
	await run(["bun", "run", "test:package"], projectRoot, { npm_config_cache: npmCache });
	process.stdout.write("release_check=READY npm_cache=isolated publish=not_run\n");
} finally {
	await rm(root, { recursive: true, force: true });
}
