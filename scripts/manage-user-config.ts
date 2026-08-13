import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";

const MANIFEST_NAME = "research-harness-install.json";
const DEFAULT_ROLES_FILE = path.resolve(import.meta.dir, "..", "config", "model-roles.yml");
const MANAGED_ROLE_NAMES = new Set(["default", "frontier", "layer", "atomic", "collision", "review", "commit"]);

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

function validateManagedRoles(value: unknown, source: string): Record<string, string> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source} must contain a modelRoles object`);
	const candidate = "modelRoles" in value ? (value as { modelRoles?: unknown }).modelRoles : value;
	if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
		throw new Error(`${source} must contain a modelRoles object`);
	}
	const roles: Record<string, string> = {};
	for (const [role, selector] of Object.entries(candidate)) {
		if (!MANAGED_ROLE_NAMES.has(role)) {
			throw new Error(`${source} contains an unmanaged role: ${role}; allowed roles: ${[...MANAGED_ROLE_NAMES].join(", ")}`);
		}
		if (typeof selector !== "string" || !selector.trim()) throw new Error(`${source} has an empty model selector for ${role}`);
		roles[role] = selector.trim();
	}
	return roles;
}

async function loadRolesFile(filePath: string): Promise<Record<string, string>> {
	const resolved = path.resolve(filePath);
	const contents = await readFile(resolved, "utf8");
	let value: unknown;
	try {
		value = resolved.endsWith(".json") ? JSON.parse(contents) : Bun.YAML.parse(contents);
	} catch (error) {
		throw new Error(`cannot parse model roles file ${resolved}: ${error instanceof Error ? error.message : String(error)}`);
	}
	return validateManagedRoles(value, resolved);
}

async function resolveManagedRoles(options: { rolesFile?: string; roleOverrides: string[] }): Promise<Record<string, string>> {
	const defaults = await loadRolesFile(DEFAULT_ROLES_FILE);
	const fromFile = options.rolesFile ? await loadRolesFile(options.rolesFile) : {};
	const overrides: Record<string, string> = {};
	for (const assignment of options.roleOverrides) {
		const separator = assignment.indexOf("=");
		if (separator <= 0) throw new Error(`invalid --role value: ${assignment}; expected role=model-selector`);
		const role = assignment.slice(0, separator).trim();
		const selector = assignment.slice(separator + 1).trim();
		Object.assign(overrides, validateManagedRoles({ [role]: selector }, "--role"));
	}
	const roles = { ...defaults, ...fromFile, ...overrides };
	for (const role of MANAGED_ROLE_NAMES) {
		if (!roles[role]) throw new Error(`model role ${role} has no configured selector`);
	}
	return roles;
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

async function install(options: { dryRun: boolean; rolesFile?: string; roleOverrides: string[] }): Promise<void> {
	const projectRoot = path.resolve(import.meta.dir, "..");
	const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8")) as { version: string };
	const sourceSystem = path.join(projectRoot, "SYSTEM.md");
	const sourceBytes = await readFile(sourceSystem);
	const agentDir = path.resolve(process.env.PI_CODING_AGENT_DIR?.trim() || path.join(homedir(), ".omp", "agent"));
	const systemTarget = path.join(agentDir, "SYSTEM.md");
	const manifestPath = path.join(agentDir, MANIFEST_NAME);
	if (existsSync(manifestPath)) throw new Error(`research harness is already installed: ${manifestPath}`);
	const managedRoles = await resolveManagedRoles(options);
	const rolesBefore = await getModelRoles();
	const rolesAfter = { ...rolesBefore, ...managedRoles };
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
		managed_roles: managedRoles,
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

async function configure(options: { dryRun: boolean; rolesFile?: string; roleOverrides: string[] }): Promise<void> {
	const agentDir = path.resolve(process.env.PI_CODING_AGENT_DIR?.trim() || path.join(homedir(), ".omp", "agent"));
	const manifestPath = path.join(agentDir, MANIFEST_NAME);
	if (!existsSync(manifestPath)) throw new Error(`research harness install manifest not found: ${manifestPath}`);
	const manifest = await readManifest(manifestPath);
	validateManifestScope(manifest, agentDir);
	const managedRoles = await resolveManagedRoles(options);
	const currentRoles = await getModelRoles();
	const configuredRoles = { ...currentRoles, ...managedRoles };
	const configuredManifest: InstallManifest = { ...manifest, managed_roles: managedRoles };
	if (options.dryRun) {
		process.stdout.write(`${JSON.stringify({ action: "configure", dry_run: true, managedRoles, configuredRoles }, null, 2)}\n`);
		return;
	}
	try {
		await setModelRoles(configuredRoles);
		if (process.env.RESEARCH_HARNESS_TEST_FAIL_AFTER === "roles") throw new Error("simulated failure after modelRoles configure");
		await atomicWrite(manifestPath, Buffer.from(`${JSON.stringify(configuredManifest, null, 2)}\n`), 0o600);
	} catch (error) {
		const rollbackErrors: string[] = [];
		await setModelRoles(currentRoles).catch(value => rollbackErrors.push(String(value)));
		throw new Error(
			`configure failed and model roles were restored: ${error instanceof Error ? error.message : String(error)}` +
				(rollbackErrors.length ? `; rollback errors: ${rollbackErrors.join("; ")}` : ""),
		);
	}
	process.stdout.write(`Configured research harness model roles transactionally. manifest=${manifestPath}\n`);
}

async function upgrade(options: { dryRun: boolean; rolesFile?: string; roleOverrides: string[] }): Promise<void> {
	const projectRoot = path.resolve(import.meta.dir, "..");
	const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8")) as { version: string };
	const sourceBytes = await readFile(path.join(projectRoot, "SYSTEM.md"));
	const agentDir = path.resolve(process.env.PI_CODING_AGENT_DIR?.trim() || path.join(homedir(), ".omp", "agent"));
	const manifestPath = path.join(agentDir, MANIFEST_NAME);
	if (!existsSync(manifestPath)) throw new Error(`research harness install manifest not found: ${manifestPath}`);
	const manifestBytes = await readFile(manifestPath);
	const manifest = await readManifest(manifestPath);
	validateManifestScope(manifest, agentDir);
	const currentRoles = await getModelRoles();
	const currentSystem = existsSync(manifest.system_target) ? await readFile(manifest.system_target) : undefined;
	const conflicts: string[] = [];
	if (!currentSystem || sha256(currentSystem) !== manifest.installed_system_sha256) conflicts.push("SYSTEM.md changed after install");
	for (const [role, installedValue] of Object.entries(manifest.managed_roles)) {
		if (currentRoles[role] !== installedValue) conflicts.push(`modelRoles.${role} changed after install`);
	}
	if (conflicts.length) {
		throw new Error(`upgrade refused because installed values drifted: ${conflicts.join("; ")}. Resolve the drift or reinstall explicitly.`);
	}
	const defaults = await resolveManagedRoles({ roleOverrides: [] });
	const managedRoles = options.rolesFile || options.roleOverrides.length
		? await resolveManagedRoles(options)
		: { ...defaults, ...manifest.managed_roles };
	const upgradedRoles = { ...currentRoles, ...managedRoles };
	const upgradedManifest: InstallManifest = {
		...manifest,
		package_version: packageJson.version,
		installed_system_sha256: sha256(sourceBytes),
		managed_roles: managedRoles,
	};
	if (options.dryRun) {
		process.stdout.write(`${JSON.stringify({
			action: "upgrade",
			dry_run: true,
			packageVersion: packageJson.version,
			managedRoles,
			upgradedRoles,
		}, null, 2)}\n`);
		return;
	}
	try {
		await atomicWrite(manifest.system_target, sourceBytes, 0o644);
		if (process.env.RESEARCH_HARNESS_TEST_FAIL_AFTER === "system") throw new Error("simulated failure after SYSTEM.md upgrade");
		await setModelRoles(upgradedRoles);
		if (process.env.RESEARCH_HARNESS_TEST_FAIL_AFTER === "roles") throw new Error("simulated failure after modelRoles upgrade");
		await atomicWrite(manifestPath, Buffer.from(`${JSON.stringify(upgradedManifest, null, 2)}\n`), 0o600);
	} catch (error) {
		const rollbackErrors: string[] = [];
		if (currentSystem) {
			await atomicWrite(manifest.system_target, currentSystem, 0o644).catch(value => rollbackErrors.push(String(value)));
		} else await rm(manifest.system_target, { force: true }).catch(value => rollbackErrors.push(String(value)));
		await setModelRoles(currentRoles).catch(value => rollbackErrors.push(String(value)));
		await atomicWrite(manifestPath, manifestBytes, 0o600).catch(value => rollbackErrors.push(String(value)));
		throw new Error(
			`upgrade failed and installed user config was restored: ${error instanceof Error ? error.message : String(error)}` +
			(rollbackErrors.length ? `; rollback errors: ${rollbackErrors.join("; ")}` : ""),
		);
	}
	process.stdout.write(`Upgraded research harness user config transactionally. manifest=${manifestPath}\n`);
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
	const projectRoot = path.resolve(import.meta.dir, "..");
	const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8")) as { version: string };
	const sourceSystem = await readFile(path.join(projectRoot, "SYSTEM.md"));
	const agentDir = path.resolve(process.env.PI_CODING_AGENT_DIR?.trim() || path.join(homedir(), ".omp", "agent"));
	const manifestPath = path.join(agentDir, MANIFEST_NAME);
	if (!existsSync(manifestPath)) {
		process.stdout.write(`${JSON.stringify({ installed: false, manifest: manifestPath }, null, 2)}\n`);
		return;
	}
	const manifest = await readManifest(manifestPath);
	validateManifestScope(manifest, agentDir);
	const roles = await getModelRoles();
	const defaultRoles = await resolveManagedRoles({ roleOverrides: [] });
	const desiredRoles = { ...defaultRoles, ...manifest.managed_roles };
	const systemMatches =
		existsSync(manifest.system_target) && sha256(await readFile(manifest.system_target)) === manifest.installed_system_sha256;
	const sourceSystemMatches =
		existsSync(manifest.system_target) && sha256(await readFile(manifest.system_target)) === sha256(sourceSystem);
	const roleDrift = Object.fromEntries(
		Object.entries(desiredRoles)
			.filter(([role, value]) => roles[role] !== value)
			.map(([role, value]) => [role, { expected: value, actual: roles[role] ?? null }]),
	);
	const missingManagedRoles = Object.keys(defaultRoles).filter(role => !Object.hasOwn(manifest.managed_roles, role));
	const upgradeRequired =
		manifest.package_version !== packageJson.version || !sourceSystemMatches || missingManagedRoles.length > 0 || Object.keys(roleDrift).length > 0;
	process.stdout.write(
		`${JSON.stringify({
			installed: true,
			manifest: manifestPath,
			package_version: manifest.package_version,
			source_package_version: packageJson.version,
			systemMatches,
			sourceSystemMatches,
			missingManagedRoles,
			roleDrift,
			upgradeRequired,
		}, null, 2)}\n`,
	);
}

const rawArgs = process.argv.slice(2);
const action = rawArgs[0]?.startsWith("-") || !rawArgs[0] ? "install" : rawArgs.shift()!;
let dryRun = false;
let force = false;
let rolesFile: string | undefined;
const roleOverrides: string[] = [];
let parseError = "";
for (let index = 0; index < rawArgs.length; index += 1) {
	const argument = rawArgs[index]!;
	if (argument === "--dry-run") dryRun = true;
	else if (argument === "--force") force = true;
	else if (argument === "--roles-file" || argument === "--role") {
		const value = rawArgs[index + 1];
		if (!value || value.startsWith("--")) {
			parseError = `${argument} requires a value`;
			break;
		}
		index += 1;
		if (argument === "--roles-file") {
			if (rolesFile) parseError = "--roles-file may only be specified once";
			rolesFile = value;
		} else roleOverrides.push(value);
	} else {
		parseError = `unknown option: ${argument}`;
		break;
	}
}
const rolesRequested = Boolean(rolesFile || roleOverrides.length);
if (
	parseError ||
	!["install", "configure", "upgrade", "uninstall", "status"].includes(action) ||
	(force && action !== "uninstall") ||
	(rolesRequested && !["install", "configure", "upgrade"].includes(action)) ||
	(action === "configure" && !rolesRequested) ||
	(action === "status" && dryRun)
) {
	if (parseError) process.stderr.write(`${parseError}\n`);
	process.stderr.write(
		"Usage: install-user-config.sh [install|configure|upgrade|uninstall|status] [--dry-run] [--force] [--roles-file PATH] [--role ROLE=MODEL]\n",
	);
	process.exit(64);
}

try {
	if (action === "install") await install({ dryRun, rolesFile, roleOverrides });
	else if (action === "configure") await configure({ dryRun, rolesFile, roleOverrides });
	else if (action === "upgrade") await upgrade({ dryRun, rolesFile, roleOverrides });
	else if (action === "uninstall") await uninstall({ dryRun, force });
	else await status();
} catch (error) {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(1);
}
