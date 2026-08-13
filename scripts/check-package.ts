import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { createBootState, resolveSkillDir, verifySkillLock } from "../extensions/iph";

const projectRoot = path.resolve(import.meta.dir, "..");
const required = [
	"SYSTEM.md",
	"CHANGELOG.md",
	"extensions/iph.ts",
	"scripts/omp-e2e.ts",
	"scripts/install-e2e.ts",
	"scripts/package-e2e.ts",
	"scripts/install-user-config.sh",
	"scripts/manage-user-config.ts",
	"tsconfig.json",
	"agents/atomic-claim-extractor.md",
	"agents/collision-synthesizer.md",
	"agents/iph-reviewer.md",
	"commands/iph.md",
	"commands/iph-status.md",
	"commands/iph-review.md",
	"schemas/lifecycle_state.schema.json",
	"config/model-roles.yml",
	"config/iph-lock.json",
];

for (const relative of required) {
	const contents = await readFile(path.join(projectRoot, relative), "utf8");
	if (!contents.trim()) throw new Error(`missing or empty delivery artifact: ${relative}`);
}

const pkg = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
if (
	pkg.name !== "@prcbooboo/omp-research-harness" ||
	pkg.version !== "0.0.2" ||
	pkg.omp?.version !== pkg.version ||
	!pkg.omp?.extensions?.includes("extensions/iph.ts")
) {
	throw new Error("package.json is not a V0.0.2 OMP extension package");
}
if (pkg.private || pkg.publishConfig?.access !== "public" || pkg.publishConfig?.provenance !== true) {
	throw new Error("package.json is not configured for a public provenance-backed release");
}
const expectedRepository = process.env.EXPECTED_GITHUB_REPOSITORY;
if (expectedRepository) {
	const expectedUrl = `git+https://github.com/${expectedRepository}.git`;
	if (pkg.repository?.type !== "git" || pkg.repository?.url !== expectedUrl) {
		throw new Error(`package repository must match provenance source exactly: ${expectedUrl}`);
	}
}
for (const runtimeFile of ["scripts/install-user-config.sh", "scripts/manage-user-config.ts"]) {
	if (!pkg.files?.includes(runtimeFile)) throw new Error(`published package omits runtime file: ${runtimeFile}`);
}

const skillDir = resolveSkillDir();
if (!skillDir) throw new Error("authoritative iph checkout not found; set IPH_SKILL_DIR");
const skillLock = await verifySkillLock(skillDir);
if (!skillLock.ok) throw new Error(`authoritative iph checkout lock failed: ${skillLock.reason}`);

const tempRoot = await mkdtemp(path.join(tmpdir(), "omp-research-harness-check-"));
try {
	const state = createBootState({
		workflowId: "package-check",
		outputType: "JOURNAL_ARTICLE",
		claimProfile: "MIXED",
	});
	await writeFile(path.join(tempRoot, "workflow_state.json"), `${JSON.stringify(state, null, 2)}\n`);
	const child = Bun.spawn(
		[
			process.env.IPH_PYTHON || "python3",
			path.join(skillDir, "scripts", "iph.py"),
			"validate",
			"--strict-new-checks",
			"--root",
			tempRoot,
			"--state",
			path.join(tempRoot, "workflow_state.json"),
		],
		{ cwd: tempRoot, stdout: "pipe", stderr: "pipe", env: { ...process.env, IPH_NO_LOCK: "1" } },
	);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (exitCode !== 0) throw new Error(`BOOT state rejected by authoritative iph:\n${stdout}\n${stderr}`);
	process.stdout.write(`package_check=READY\n${stdout}`);
} finally {
	await rm(tempRoot, { recursive: true, force: true });
}
