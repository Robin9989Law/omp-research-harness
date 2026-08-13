import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { loadExtensions } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import { EventBus } from "@oh-my-pi/pi-coding-agent/utils/event-bus";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function run(command: string[], options: { cwd: string; env?: Record<string, string> }): Promise<string> {
	const child = Bun.spawn(command, {
		cwd: options.cwd,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, ...options.env },
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (exitCode !== 0) throw new Error(`${command.join(" ")} failed (${exitCode}):\n${stderr || stdout}`);
	return stdout;
}

const projectRoot = path.resolve(import.meta.dir, "..");
const ompBin = process.env.OMP_BIN?.trim() || path.join(projectRoot, "node_modules", ".bin", "omp");
const root = await mkdtemp(path.join(tmpdir(), "research-harness-package-e2e-"));

try {
	const packOutput = await run(["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", root], {
		cwd: projectRoot,
	});
	const packed = JSON.parse(packOutput) as Array<{ filename?: string }>;
	const filename = packed[0]?.filename;
	assert(filename, `npm pack did not report a tarball: ${packOutput}`);
	const tarball = path.join(root, filename);
	const unpackRoot = path.join(root, "unpacked");
	await mkdir(unpackRoot);
	await run(["tar", "-xzf", tarball, "-C", unpackRoot], { cwd: root });
	const packageRoot = path.join(unpackRoot, "package");
	assert(existsSync(path.join(packageRoot, "extensions", "iph.ts")), "tarball omitted the OMP extension");
	assert(existsSync(path.join(packageRoot, "scripts", "install-user-config.sh")), "tarball omitted the installer");
	assert(!existsSync(path.join(packageRoot, "tests")), "tarball unexpectedly contains development tests");

	const loaded = await loadExtensions(
		[path.join(packageRoot, "extensions", "iph.ts")],
		packageRoot,
		new EventBus(),
	);
	assert(loaded.errors.length === 0, `packed extension failed real OMP loading: ${JSON.stringify(loaded.errors)}`);
	assert(loaded.extensions.length === 1 && loaded.extensions[0]!.tools.size === 9, "packed extension registered the wrong tool set");

	const isolatedAgent = path.join(root, "agent");
	const installDryRun = await run([path.join(packageRoot, "scripts", "install-user-config.sh"), "install", "--dry-run"], {
		cwd: packageRoot,
		env: { PI_CODING_AGENT_DIR: isolatedAgent, OMP_BIN: ompBin },
	});
	assert(installDryRun.includes('"dry_run": true'), "packed installer dry-run did not execute");
	assert(!existsSync(path.join(isolatedAgent, "SYSTEM.md")), "packed installer dry-run changed SYSTEM.md");
	assert(!existsSync(path.join(isolatedAgent, "research-harness-install.json")), "packed installer dry-run wrote a manifest");

	process.stdout.write("package_e2e=READY tarball=runtime-only loader=real installer=dry-run\n");
} finally {
	await rm(root, { recursive: true, force: true });
}
