import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const projectRoot = path.resolve(import.meta.dir, "..");
const installer = path.join(projectRoot, "scripts", "install-user-config.sh");
const ompBin = process.env.OMP_BIN?.trim() || path.join(projectRoot, "node_modules", ".bin", "omp");

async function run(
	agentDir: string,
	args: string[],
	extraEnv: Record<string, string> = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const child = Bun.spawn([installer, ...args], {
		cwd: projectRoot,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, OMP_BIN: ompBin, ...extraEnv },
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { exitCode, stdout, stderr };
}

async function setRoles(agentDir: string, roles: Record<string, string>): Promise<void> {
	const child = Bun.spawn([ompBin, "config", "set", "modelRoles", JSON.stringify(roles)], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
	});
	const stderr = await new Response(child.stderr).text();
	assert((await child.exited) === 0, `failed to seed model roles: ${stderr}`);
}

async function getRoles(agentDir: string): Promise<Record<string, string>> {
	const child = Bun.spawn([ompBin, "config", "get", "modelRoles", "--json"], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
	});
	const stdout = await new Response(child.stdout).text();
	assert((await child.exited) === 0, "failed to read model roles");
	return JSON.parse(stdout).value;
}

const testRoot = await mkdtemp(path.join(tmpdir(), "research-harness-install-e2e-"));
try {
	const agentDir = path.join(testRoot, "roundtrip-agent");
	await setRoles(agentDir, { default: "old/default", commit: "old/commit", unrelated: "keep/me" });
	await writeFile(path.join(agentDir, "SYSTEM.md"), "original system\n");
	const dryRun = await run(agentDir, ["install", "--dry-run"]);
	assert(dryRun.exitCode === 0 && dryRun.stdout.includes('"dry_run": true'), `install dry-run failed: ${dryRun.stderr}`);
	assert((await readFile(path.join(agentDir, "SYSTEM.md"), "utf8")) === "original system\n", "dry-run changed SYSTEM.md");
	assert(!Bun.file(path.join(agentDir, "research-harness-install.json")).size, "dry-run created an install manifest");

	const installed = await run(agentDir, ["install"]);
	assert(installed.exitCode === 0, `install failed: ${installed.stderr}`);
	const manifestPath = path.join(agentDir, "research-harness-install.json");
	assert(Bun.file(manifestPath).size > 0, "install did not write its transaction manifest");
	assert(
		(await readFile(path.join(agentDir, "SYSTEM.md"), "utf8")) === (await readFile(path.join(projectRoot, "SYSTEM.md"), "utf8")),
		"install did not deploy the harness SYSTEM.md",
	);
	let installedRoles = await getRoles(agentDir);
	assert(installedRoles.default === "minimax-code-cn/MiniMax-M3:high", "install did not keep M3 as the main coordinator");
	assert(installedRoles.frontier === "openai-codex/gpt-5.6-sol:high", "install did not route frontier adjudication to GPT");
	assert(installedRoles.layer === "openai-codex/gpt-5.6-sol:high", "install did not route layer adjudication to GPT");
	assert(installedRoles.atomic === "openai-codex/gpt-5.6-sol:high", "install did not set managed model roles");
	assert(installedRoles.commit === "minimax-code-cn/MiniMax-M3:high", "install did not keep commit on the default M3 model");
	assert(installedRoles.unrelated === "keep/me", "install clobbered an unrelated model role");
	const customRolesFile = path.join(testRoot, "custom-roles.yml");
	await writeFile(customRolesFile, "modelRoles:\n  review: user/custom-review:high\n");
	const configureDryRun = await run(agentDir, [
		"configure",
		"--dry-run",
		"--roles-file",
		customRolesFile,
		"--role",
		"atomic=user/custom-atomic:max",
	]);
	assert(configureDryRun.exitCode === 0 && configureDryRun.stdout.includes('"action": "configure"'), `configure dry-run failed: ${configureDryRun.stderr}`);
	assert((await getRoles(agentDir)).atomic === installedRoles.atomic, "configure dry-run changed model roles");
	const configured = await run(agentDir, [
		"configure",
		"--roles-file",
		customRolesFile,
		"--role",
		"atomic=user/custom-atomic:max",
	]);
	assert(configured.exitCode === 0, `configure failed: ${configured.stderr}`);
	installedRoles = await getRoles(agentDir);
	assert(installedRoles.atomic === "user/custom-atomic:max" && installedRoles.review === "user/custom-review:high", "configure did not apply custom roles");
	const failedConfigure = await run(agentDir, ["configure", "--role", "atomic=user/rollback-test"], {
		RESEARCH_HARNESS_TEST_FAIL_AFTER: "roles",
	});
	assert(failedConfigure.exitCode !== 0 && failedConfigure.stderr.includes("were restored"), "failed configure did not report rollback");
	assert((await getRoles(agentDir)).atomic === installedRoles.atomic, "failed configure did not restore current model roles");
	const unmanagedRole = await run(agentDir, ["configure", "--role", "task=user/not-managed"]);
	assert(unmanagedRole.exitCode !== 0 && unmanagedRole.stderr.includes("unmanaged role"), "configure accepted an unmanaged role");
	const status = await run(agentDir, ["status"]);
	assert(status.exitCode === 0 && status.stdout.includes('"systemMatches": true'), `status failed: ${status.stderr}`);

	await setRoles(agentDir, { ...installedRoles, review: "user/changed-review", unrelated: "changed/after-install" });
	const refused = await run(agentDir, ["uninstall"]);
	assert(refused.exitCode !== 0 && refused.stderr.includes("managed values changed"), "uninstall did not detect managed-role drift");
	assert(Bun.file(manifestPath).size > 0, "refused uninstall removed its recovery manifest");
	await setRoles(agentDir, { ...installedRoles, unrelated: "changed/after-install" });
	const uninstalled = await run(agentDir, ["uninstall"]);
	assert(uninstalled.exitCode === 0, `uninstall failed: ${uninstalled.stderr}`);
	assert((await readFile(path.join(agentDir, "SYSTEM.md"), "utf8")) === "original system\n", "uninstall did not restore SYSTEM.md");
	const restoredRoles = await getRoles(agentDir);
	assert(restoredRoles.default === "old/default" && restoredRoles.commit === "old/commit", "uninstall did not restore managed roles");
	assert(restoredRoles.unrelated === "changed/after-install", "uninstall clobbered a post-install unrelated role change");
	assert(!Bun.file(manifestPath).size, "uninstall left its install manifest behind");

	const forceAgent = path.join(testRoot, "force-agent");
	await setRoles(forceAgent, { default: "force/default", unrelated: "force/keep" });
	await writeFile(path.join(forceAgent, "SYSTEM.md"), "force original\n");
	const forceInstalled = await run(forceAgent, ["install"]);
	assert(forceInstalled.exitCode === 0, `force scenario install failed: ${forceInstalled.stderr}`);
	const forceInstalledRoles = await getRoles(forceAgent);
	await writeFile(path.join(forceAgent, "SYSTEM.md"), "user changed installed system\n");
	await setRoles(forceAgent, { ...forceInstalledRoles, atomic: "user/changed-atomic", unrelated: "force/changed-later" });
	const forceDryRun = await run(forceAgent, ["uninstall", "--dry-run", "--force"]);
	assert(forceDryRun.exitCode === 0 && forceDryRun.stdout.includes("SYSTEM.md changed after install"), "force dry-run omitted drift");
	assert((await readFile(path.join(forceAgent, "SYSTEM.md"), "utf8")) === "user changed installed system\n", "force dry-run mutated SYSTEM.md");
	const forced = await run(forceAgent, ["uninstall", "--force"]);
	assert(forced.exitCode === 0, `forced uninstall failed: ${forced.stderr}`);
	assert((await readFile(path.join(forceAgent, "SYSTEM.md"), "utf8")) === "force original\n", "forced uninstall did not restore SYSTEM.md");
	const forceRestoredRoles = await getRoles(forceAgent);
	assert(forceRestoredRoles.default === "force/default" && !forceRestoredRoles.atomic, "forced uninstall did not restore managed roles");
	assert(forceRestoredRoles.unrelated === "force/changed-later", "forced uninstall clobbered an unrelated role");

	const rollbackAgent = path.join(testRoot, "rollback-agent");
	await setRoles(rollbackAgent, { default: "rollback/default", unrelated: "rollback/keep" });
	await writeFile(path.join(rollbackAgent, "SYSTEM.md"), "rollback original\n");
	const failed = await run(rollbackAgent, ["install"], { RESEARCH_HARNESS_TEST_FAIL_AFTER: "roles" });
	assert(failed.exitCode !== 0 && failed.stderr.includes("was rolled back"), "simulated install failure did not report rollback");
	assert(
		(await readFile(path.join(rollbackAgent, "SYSTEM.md"), "utf8")) === "rollback original\n",
		"failed install did not restore SYSTEM.md",
	);
	const rolledBackRoles = await getRoles(rollbackAgent);
	assert(
		rolledBackRoles.default === "rollback/default" && rolledBackRoles.unrelated === "rollback/keep" && !rolledBackRoles.atomic,
		"failed install did not restore model roles",
	);
	assert(!Bun.file(path.join(rollbackAgent, "research-harness-install.json")).size, "failed install left a manifest");

	process.stdout.write("install_e2e=READY dry_run=clean install=transactional configure=custom rollback=verified uninstall=restored\n");
} finally {
	await rm(testRoot, { recursive: true, force: true });
}
