import { mkdtemp } from "node:fs/promises";
import * as path from "node:path";

function option(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

const projectRoot = path.resolve(import.meta.dir, "..");
const requestedRoot = option("--output");
const fixtureRoot = requestedRoot
	? path.resolve(requestedRoot)
	: await mkdtemp("/tmp/iph-agent-node-fixtures-full.");
const pdfCache = option("--pdf-cache")?.trim();

async function run(label: string, command: string[], env: Record<string, string | undefined> = {}): Promise<void> {
	const child = Bun.spawn(command, {
		cwd: projectRoot,
		stdin: "ignore",
		stdout: "inherit",
		stderr: "inherit",
		env: { ...process.env, ...env },
	});
	const exitCode = await child.exited;
	if (exitCode !== 0) throw new Error(`${label} failed with exit ${exitCode}`);
}

await run("fixture matrix", ["bun", "scripts/agent-node-fixtures.ts", fixtureRoot], {
	IPH_FIXTURE_PDF_CACHE: pdfCache,
});
await run("novelty terminal matrix", ["bun", "scripts/novelty-terminal-e2e.ts", fixtureRoot]);
await run("late-stage transaction", ["bun", "scripts/late-stage-e2e.ts", fixtureRoot]);

process.stdout.write(
	`full_node_e2e=READY source_states=22 positive_edges=22 negative_verdicts=2 novelty_holds=1 late_nodes=5 fixture_root=${fixtureRoot}\n`,
);
