import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";

const MANIFEST_NAME = "research-harness-install.json";
const MANAGED_ROLES: Record<string, string> = {
	default: "minimax-code-cn/MiniMax-M3:high",
	atomic: "openai/gpt-5.6-sol:high",
	collision: "openai/gpt-5.6-sol:high",
	review: "deepseek/deepseek-v4-pro:high",
	commit: "deepseek/deepseek-v4-flash:high",
};

interface InstallManifest {
	schema_version: "1.0";
	package_version: string;
	installed_at: string;
	system_target: string;
	system_existed: boolean;
	system_backup?: string;
	installed_system_sha256: string;
	model_roles_before: Record<string, unknown>;
	managed_roles: Record<string, string>;
}

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

async function atomicWrite(filePath: string, bytes: Uint8Array, mode: number): Promise<void> {
	await mkdir(path.dirname(filePath), { recursive: true });
	const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
	try {
		await writeFile(temporary, bytes, { flag: "wx", mode });
		await rename(temporary, filePath);
		await chmod(filePath, mode);
	} finally {
		await rm(temporary, { force: true }).catch(() => undefined);
	}
}

async function runOmp(args: string[]): Promise<string> {
	const executable = process.env.OMP_BIN?.trim() || "omp";
	const child = Bun.spawn([executable, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: process.env,
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (exitCode !== 0) throw new Error(`omp ${args.join(" ")} failed (${exitCode}): ${stderr.trim() || stdout.trim()}`);
	return stdout;
}

async function getModelRoles(): Promise<Record<string, unknown>> {
	const payload = JSON.parse(await runOmp(["config", "get", "modelRoles", "--json"])) as { value?: unknown };
	return payload.value && typeof payload.value === "object" && !Array.isArray(payload.value)
		? { ...(payload.value as Record<string, unknown>) }
		: {};
}

async function setModelRoles(roles: Record<string, unknown>): Promise<void> {
	await runOmp(["config", "set", "modelRoles", JSON.stringify(roles)]);
}

async function readManifest(manifestPath: string): Promise<InstallManifest> {
	const value = JSON.parse(await readFile(manifestPath, "utf8")) as Partial<InstallManifest>;
	const rolesBeforeIsObject =
		Boolean(value.model_roles_before) && typeof value.model_roles_before === "object" && !Array.isArray(value.model_roles_before);
	const managedRolesAreValid =
		Boolean(value.managed_roles) &&
		typeof value.managed_roles === "object" &&
		!Array.isArray(value.managed_roles) &&
		Object.values(value.managed_roles).every(role => typeof role === "string" && role.length > 0);
	if (
		value.schema_version !== "1.0" ||
		typeof value.system_target !== "string" ||
		typeof value.system_existed !== "boolean" ||
		!/^([0-9a-f]{64})$/.test(value.installed_system_sha256 ?? "") ||
		(value.system_backup !== undefined && typeof value.system_backup !== "string") ||
		!rolesBeforeIsObject ||
		!managedRolesAreValid
	) {
		throw new Error(`invalid install manifest: ${manifestPath}`);
	}
	return value as InstallManifest;
}

function validateManifestScope(manifest: InstallManifest, agentDir: string): void {
	const expectedSystem = path.join(agentDir, "SYSTEM.md");
	if (path.resolve(manifest.system_target) !== expectedSystem) {
		throw new Error(`install manifest SYSTEM.md target escapes the agent directory: ${manifest.system_target}`);
	}
	if (manifest.system_existed) {
		if (!manifest.system_backup) throw new Error("install manifest is missing the required SYSTEM.md backup path");
		const backupRoot = path.join(agentDir, "backups");
		const relative = path.relative(backupRoot, path.resolve(manifest.system_backup));
		if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || path.basename(relative) !== "SYSTEM.md") {
			throw new Error(`install manifest backup path escapes the managed backup directory: ${manifest.system_backup}`);
		}
	}
}

async function restoreSystem(manifest: InstallManifest): Promise<void> {
	if (manifest.system_existed) {
		if (!manifest.system_backup || !existsSync(manifest.system_backup)) {
			throw new Error(`SYSTEM.md backup is missing: ${manifest.system_backup ?? "(none)"}`);
		}
		await atomicWrite(manifest.system_target, await readFile(manifest.system_backup), 0o644);
	} else {
		await rm(manifest.system_target, { force: true });
	}
}

async function install(options: { dryRun: boolean }): Promise<void> {
	const projectRoot = path.resolve(import.meta.dir, "..");
	const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8")) as { version: string };
	const sourceSystem = path.join(projectRoot, "SYSTEM.md");
	const sourceBytes = await readFile(sourceSystem);
	const agentDir = path.resolve(process.env.PI_CODING_AGENT_DIR?.trim() || path.join(homedir(), ".omp", "agent"));
	const systemTarget = path.join(agentDir, "SYSTEM.md");
	const manifestPath = path.join(agentDir, MANIFEST_NAME);
	if (existsSync(manifestPath)) throw new Error(`research harness is already installed: ${manifestPath}`);
	const rolesBefore = await getModelRoles();
	const rolesAfter = { ...rolesBefore, ...MANAGED_ROLES };
	const systemExisted = existsSync(systemTarget);
	const transactionId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
	const backupDir = path.join(agentDir, "backups", `research-harness-${transactionId}`);
	const backupPath = path.join(backupDir, "SYSTEM.md");
	const manifest: InstallManifest = {
		schema_version: "1.0",
		package_version: packageJson.version,
		installed_at: new Date().toISOString(),
		system_target: systemTarget,
		system_existed: systemExisted,
		...(systemExisted ? { system_backup: backupPath } : {}),
		installed_system_sha256: sha256(sourceBytes),
		model_roles_before: rolesBefore,
		managed_roles: MANAGED_ROLES,
	};
	if (options.dryRun) {
		process.stdout.write(`${JSON.stringify({ action: "install", dry_run: true, systemTarget, systemExisted, rolesAfter }, null, 2)}\n`);
		return;
	}

	let systemInstalled = false;
	let rolesAttempted = false;
	try {
		await mkdir(agentDir, { recursive: true });
		if (systemExisted) {
			await mkdir(backupDir, { recursive: true });
			await copyFile(systemTarget, backupPath);
		}
		await atomicWrite(systemTarget, sourceBytes, 0o644);
		systemInstalled = true;
		if (process.env.RESEARCH_HARNESS_TEST_FAIL_AFTER === "system") throw new Error("simulated failure after SYSTEM.md install");
		rolesAttempted = true;
		await setModelRoles(rolesAfter);
		if (process.env.RESEARCH_HARNESS_TEST_FAIL_AFTER === "roles") throw new Error("simulated failure after modelRoles install");
		await atomicWrite(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), 0o600);
		process.stdout.write(`Installed research harness user config transactionally. manifest=${manifestPath}\n`);
	} catch (error) {
		const rollbackErrors: string[] = [];
		if (rolesAttempted) await setModelRoles(rolesBefore).catch(value => rollbackErrors.push(String(value)));
		if (systemInstalled) await restoreSystem(manifest).catch(value => rollbackErrors.push(String(value)));
		await rm(manifestPath, { force: true }).catch(value => rollbackErrors.push(String(value)));
		await rm(backupDir, { recursive: true, force: true }).catch(value => rollbackErrors.push(String(value)));
		throw new Error(
			`install failed and was rolled back: ${error instanceof Error ? error.message : String(error)}` +
				(rollbackErrors.length ? `; rollback errors: ${rollbackErrors.join("; ")}` : ""),
		);
	}
}

async function uninstall(options: { dryRun: boolean; force: boolean }): Promise<void> {
	const agentDir = path.resolve(process.env.PI_CODING_AGENT_DIR?.trim() || path.join(homedir(), ".omp", "agent"));
	const manifestPath = path.join(agentDir, MANIFEST_NAME);
	if (!existsSync(manifestPath)) throw new Error(`research harness install manifest not found: ${manifestPath}`);
	const manifest = await readManifest(manifestPath);
	validateManifestScope(manifest, agentDir);
	const currentRoles = await getModelRoles();
	const conflicts: string[] = [];
	const currentSystem = existsSync(manifest.system_target) ? await readFile(manifest.system_target) : undefined;
	if (!currentSystem || sha256(currentSystem) !== manifest.installed_system_sha256) conflicts.push("SYSTEM.md changed after install");
	for (const [role, installedValue] of Object.entries(manifest.managed_roles)) {
		if (currentRoles[role] !== installedValue) conflicts.push(`modelRoles.${role} changed after install`);
	}
	if (conflicts.length && !options.force) {
		throw new Error(`uninstall refused because managed values changed: ${conflicts.join("; ")}. Re-run with --force to restore pre-install values.`);
	}
	const restoredRoles = { ...currentRoles };
	for (const role of Object.keys(manifest.managed_roles)) {
		if (Object.hasOwn(manifest.model_roles_before, role)) restoredRoles[role] = manifest.model_roles_before[role];
		else delete restoredRoles[role];
	}
	if (options.dryRun) {
		process.stdout.write(`${JSON.stringify({ action: "uninstall", dry_run: true, conflicts, restoredRoles }, null, 2)}\n`);
		return;
	}

	const systemBeforeUninstall = currentSystem;
	try {
		await restoreSystem(manifest);
		await setModelRoles(restoredRoles);
		await rm(manifestPath);
	} catch (error) {
		const rollbackErrors: string[] = [];
		if (systemBeforeUninstall) {
			await atomicWrite(manifest.system_target, systemBeforeUninstall, 0o644).catch(value => rollbackErrors.push(String(value)));
		} else await rm(manifest.system_target, { force: true }).catch(value => rollbackErrors.push(String(value)));
		await setModelRoles(currentRoles).catch(value => rollbackErrors.push(String(value)));
		throw new Error(
			`uninstall failed and current installed values were restored: ${error instanceof Error ? error.message : String(error)}` +
			(rollbackErrors.length ? `; rollback errors: ${rollbackErrors.join("; ")}` : ""),
		);
	}
	let cleanupWarning = "";
	if (manifest.system_backup) {
		await rm(path.dirname(manifest.system_backup), { recursive: true, force: true }).catch(error => {
			cleanupWarning = ` Backup cleanup warning: ${String(error)}`;
		});
	}
	process.stdout.write(`Uninstalled research harness user config and restored pre-install managed values.${cleanupWarning}\n`);
}

async function status(): Promise<void> {
	const agentDir = path.resolve(process.env.PI_CODING_AGENT_DIR?.trim() || path.join(homedir(), ".omp", "agent"));
	const manifestPath = path.join(agentDir, MANIFEST_NAME);
	if (!existsSync(manifestPath)) {
		process.stdout.write(`${JSON.stringify({ installed: false, manifest: manifestPath }, null, 2)}\n`);
		return;
	}
	const manifest = await readManifest(manifestPath);
	validateManifestScope(manifest, agentDir);
	const roles = await getModelRoles();
	const systemMatches =
		existsSync(manifest.system_target) && sha256(await readFile(manifest.system_target)) === manifest.installed_system_sha256;
	const roleDrift = Object.fromEntries(
		Object.entries(manifest.managed_roles)
			.filter(([role, value]) => roles[role] !== value)
			.map(([role, value]) => [role, { expected: value, actual: roles[role] ?? null }]),
	);
	process.stdout.write(
		`${JSON.stringify({ installed: true, manifest: manifestPath, package_version: manifest.package_version, systemMatches, roleDrift }, null, 2)}\n`,
	);
}

const rawArgs = process.argv.slice(2);
const action = rawArgs[0]?.startsWith("-") || !rawArgs[0] ? "install" : rawArgs.shift()!;
const dryRun = rawArgs.includes("--dry-run");
const force = rawArgs.includes("--force");
const unknown = rawArgs.filter(value => value !== "--dry-run" && value !== "--force");
if (unknown.length || !["install", "uninstall", "status"].includes(action) || (force && action !== "uninstall")) {
	process.stderr.write("Usage: install-user-config.sh [install|uninstall|status] [--dry-run] [--force]\n");
	process.exit(64);
}

try {
	if (action === "install") await install({ dryRun });
	else if (action === "uninstall") await uninstall({ dryRun, force });
	else await status();
} catch (error) {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(1);
}
