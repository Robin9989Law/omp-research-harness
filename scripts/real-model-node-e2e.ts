import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import { resolveSkillDir, transitionPlanForState } from "../extensions/iph";

type JsonObject = Record<string, any>;

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function option(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

async function exists(file: string): Promise<boolean> {
	return stat(file).then(() => true).catch(() => false);
}

async function copyIfPresent(source: string, targetDirectory: string): Promise<void> {
	if (await exists(source)) await cp(source, path.join(targetDirectory, path.basename(source)));
}

async function jsonFiles(root: string): Promise<string[]> {
	const found: string[] = [];
	const visit = async (directory: string): Promise<void> => {
		for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
			const absolute = path.join(directory, entry.name);
			if (entry.isDirectory()) await visit(absolute);
			else if (entry.isFile() && entry.name.endsWith(".jsonl")) found.push(absolute);
		}
	};
	await visit(root);
	return found.sort();
}

async function modelChanges(root: string, sinceMs: number): Promise<JsonObject[]> {
	const changes: JsonObject[] = [];
	for (const file of await jsonFiles(root)) {
		const metadata = await stat(file).catch(() => undefined);
		if (!metadata || metadata.mtimeMs < sinceMs) continue;
		for (const line of (await readFile(file, "utf8")).split("\n")) {
			if (!line.trim()) continue;
			try {
				const entry = JSON.parse(line) as JsonObject;
				if (entry.type === "model_change" && typeof entry.model === "string") {
					changes.push({
						file: path.relative(root, file),
						model: entry.model,
						resolvedModelIsFallback: entry.resolvedModelIsFallback ?? null,
					});
				}
			} catch {
				// Non-JSON diagnostics cannot establish model provenance.
			}
		}
	}
	return changes;
}

async function toolCalls(root: string, sinceMs: number): Promise<JsonObject[]> {
	const counts = new Map<string, JsonObject>();
	for (const file of await jsonFiles(root)) {
		const metadata = await stat(file).catch(() => undefined);
		if (!metadata || metadata.mtimeMs < sinceMs) continue;
		for (const line of (await readFile(file, "utf8")).split("\n")) {
			if (!line.trim()) continue;
			try {
				const entry = JSON.parse(line) as JsonObject;
				if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
				for (const content of Array.isArray(entry.message.content) ? entry.message.content : []) {
					if (content?.type === "toolCall" && typeof content.name === "string") {
						const relativeFile = path.relative(root, file);
						const key = `${relativeFile}\0${content.name}`;
						const existing = counts.get(key);
						if (existing) existing.count += 1;
						else counts.set(key, { file: relativeFile, name: content.name, count: 1 });
					}
				}
			} catch {
				// Non-JSON diagnostics cannot establish tool provenance.
			}
		}
	}
	return [...counts.values()];
}

async function sessionInits(root: string, sinceMs: number): Promise<JsonObject[]> {
	const sessions: JsonObject[] = [];
	for (const file of await jsonFiles(root)) {
		const metadata = await stat(file).catch(() => undefined);
		if (!metadata || metadata.mtimeMs < sinceMs) continue;
		for (const line of (await readFile(file, "utf8")).split("\n")) {
			if (!line.trim()) continue;
			try {
				const entry = JSON.parse(line) as JsonObject;
				if (entry.type === "session_init" && typeof entry.agent === "string") {
					sessions.push({
						file: path.relative(root, file),
						agent: entry.agent,
						modelRole: entry.modelRole ?? null,
						resolvedModel: entry.resolvedModel ?? null,
					});
				}
			} catch {
				// Non-JSON diagnostics cannot establish subagent identity.
			}
		}
	}
	return sessions;
}

const EDGE_TARGETS: Record<string, string> = {
	INDEPENDENT_REVIEW: "DIRECTION_LOCK",
	DIRECTION_LOCK: "COMPUTE",
	COMPUTE: "POSTCOMPUTE_CLAIM_FREEZE",
	POSTCOMPUTE_CLAIM_FREEZE: "FINAL_VALIDITY_AUDIT",
	FINAL_VALIDITY_AUDIT: "FINAL_LOCK",
	FINAL_LOCK: "COMPLETE",
};

const fixtureRoot = path.resolve(option("--fixture-root") ?? "");
assert(
	fixtureRoot && await exists(path.join(fixtureRoot, "independent_review", "workflow_state.json")),
	"usage: bun scripts/real-model-node-e2e.ts --fixture-root <fresh-fixture-root> [--all-nodes] [--run-root <new-directory>] [--max-time 30m] [--dry-run]",
);
const dryRun = process.argv.includes("--dry-run");
const allNodes = process.argv.includes("--all-nodes");
const nodeMaxTime = option("--max-time") ?? "30m";
const requestedRunRoot = option("--run-root");
const runRoot = requestedRunRoot
	? path.resolve(requestedRunRoot)
	: await mkdtemp("/tmp/iph-real-model-nodes.");
if (requestedRunRoot) {
	assert(!(await exists(runRoot)), `--run-root must not already exist: ${runRoot}`);
	await mkdir(runRoot, { recursive: true });
}
const researchRoot = path.join(runRoot, "research");
const logsRoot = path.join(runRoot, "logs");
const sessionsEvidenceRoot = path.join(runRoot, "sessions");
if (allNodes) await mkdir(researchRoot, { recursive: true });
else await cp(path.join(fixtureRoot, "independent_review"), researchRoot, { recursive: true });
await mkdir(logsRoot, { recursive: true });
await mkdir(sessionsEvidenceRoot, { recursive: true });
const fixtureMatrix = JSON.parse(await readFile(path.join(fixtureRoot, "matrix.json"), "utf8")) as JsonObject;
const fixtureCases = Array.isArray(fixtureMatrix.results) ? fixtureMatrix.results as JsonObject[] : [];
assert(fixtureCases.length === 22, `fixture matrix must contain 22 positive edges, found ${fixtureCases.length}`);

const skillDir = resolveSkillDir();
assert(skillDir, "authoritative IPH skill checkout is unavailable");
const projectRoot = path.resolve(import.meta.dir, "..");
const extensionPath = path.join(projectRoot, "extensions", "iph.ts");
assert(await exists(extensionPath), `missing local IPH extension: ${extensionPath}`);
const sourceAgentDir = path.resolve(process.env.PI_CODING_AGENT_DIR?.trim() || path.join(homedir(), ".omp", "agent"));
const runtimeRoot = await mkdtemp("/tmp/omp-real-model-runtime.");
const runtimeAgent = path.join(runtimeRoot, "agent");
const runtimeSessions = path.join(runtimeRoot, "sessions");
const runtimeConfig = path.join(runtimeRoot, "config");
await mkdir(runtimeAgent, { recursive: true });
await mkdir(runtimeSessions, { recursive: true });
await mkdir(runtimeConfig, { recursive: true });
for (const name of ["SYSTEM.md", "config.yml", "research-harness-install.json", "agent.db", "models.db", "history.db"]) {
	await copyIfPresent(path.join(sourceAgentDir, name), runtimeAgent);
}
assert(await exists(path.join(runtimeAgent, "config.yml")), `missing OMP config at ${sourceAgentDir}`);
assert(await exists(path.join(runtimeAgent, "agent.db")), `missing OMP auth database at ${sourceAgentDir}`);
const runtimeConfigDocument = Bun.YAML.parse(
	await readFile(path.join(runtimeAgent, "config.yml"), "utf8"),
) as JsonObject;
const modelRoles = runtimeConfigDocument.modelRoles as JsonObject | undefined;
assert(modelRoles && typeof modelRoles === "object", "isolated runtime has no modelRoles configuration");
assert(String(modelRoles.default ?? "").startsWith("minimax-code-cn/MiniMax-M3"), "isolated runtime does not route the coordinator role to MiniMax-M3");
assert(String(modelRoles.review ?? "").startsWith("deepseek/deepseek-v4-pro"), "isolated runtime does not route the reviewer role to DeepSeek V4 Pro");
assert(String(modelRoles.event ?? "").startsWith("deepseek/deepseek-v4-flash"), "isolated runtime does not route the event role to DeepSeek V4 Flash");

const evidence: JsonObject = {
	schemaVersion: "1.0",
	startedAt: new Date().toISOString(),
	fixtureRoot,
	researchRoot,
	coordinatorModel: modelRoles.default,
	reviewerRole: modelRoles.review,
	eventRole: modelRoles.event,
	nodeMaxTime,
	mode: allNodes ? "all-nodes-isolated" : "late-nodes-continuous",
	nodes: [],
};

const commonPrompt = [
	"继续当前 IPH 工作流，只完成当前 active_state 的一条边。",
	"先调用 iph_status 与 iph_transition_plan，逐项阅读 readBeforeAct、constraints、examples 和 completionProof，再做全局判断。",
	"只读 transition plan 指定的必读文件，不自行扫描全项目，不重复执行已有 completionProof。",
	"M3 负责主流程、机会成本和 specialist disposition；不要重建项目、清锁、跳态或提前执行下一节点。",
	"plan 指定 specialist 时只派一个对应 task，不传 outputSchema/schemaMode；科学判断由 specialist 独立完成。",
	"reviewer 只能新建 review_artifacts/*.json，并在其会话调用 iph_review。实质 FAIL 必须写 required_remediation 并形成同态 INVALID+STOP；能力不可用只返回 BLOCKED_CAPABILITY。",
	"task 返回后重新调用 iph_status，验证唯一合法闭环后结束。所有终端审批已经用户授权，使用自动批准。",
].join("\n");

try {
	if (dryRun) {
		if (!allNodes) {
			const state = JSON.parse(await readFile(path.join(researchRoot, "workflow_state.json"), "utf8"));
			assert(state.active_state === "INDEPENDENT_REVIEW", "dry-run fixture does not start at Node 17");
		}
		const nodeRange = allNodes ? "1-22" : "17-22";
		process.stdout.write(`real_model_node_e2e=DRY_RUN_READY nodes=${nodeRange} research_root=${researchRoot}\n`);
		process.stdout.write(`next_command=bun scripts/real-model-node-e2e.ts --fixture-root ${fixtureRoot}${allNodes ? " --all-nodes" : ""}\n`);
		process.exitCode = 0;
	} else {
		const firstNode = allNodes ? 1 : 17;
		for (let node = firstNode; node <= 22; node += 1) {
			const fixtureCase = fixtureCases[node - 1]!;
			const expectedSource = String(fixtureCase.source ?? "");
			const nodeResearchRoot = allNodes
				? path.join(researchRoot, `node-${String(node).padStart(2, "0")}-${expectedSource.toLowerCase()}`)
				: researchRoot;
			if (allNodes) {
				await cp(path.join(fixtureRoot, expectedSource.toLowerCase()), nodeResearchRoot, { recursive: true });
			}
			const before = JSON.parse(await readFile(path.join(nodeResearchRoot, "workflow_state.json"), "utf8")) as JsonObject;
			const source = String(before.active_state ?? "");
			assert(source === expectedSource, `node ${node} fixture expected ${expectedSource}, found ${source}`);
			const target = allNodes ? String(fixtureCase.target ?? "") : EDGE_TARGETS[source];
			assert(target, `node ${node} has no registered target from ${source}`);
			const transitionPlan = transitionPlanForState(before);
			assert(transitionPlan?.target === target, `node ${node} transition plan drift: ${transitionPlan?.target} != ${target}`);
			const logPath = path.join(logsRoot, `node-${node}-${source.toLowerCase()}.log`);
			const startedAtMs = Date.now();
			process.stdout.write(`REAL_NODE_START node=${node} source=${source} target=${target} log=${logPath}\n`);
			const authorization = source === "DIRECTION_LOCK"
				? "\n用户已在本线程明确授权进入计算；该授权不旁路 N0-4C/V3 门。"
				: "";
			const configRelativeToHome = path.relative(homedir(), runtimeConfig);
			const child = Bun.spawn([
				"omp",
				"--no-pty",
				"--no-lsp",
				"--plugin-dir", projectRoot,
				"--extension", extensionPath,
				"--cwd", nodeResearchRoot,
				"--session-dir", runtimeSessions,
				"--model", "minimax-code-cn/MiniMax-M3",
				"--thinking", "high",
				"--approval-mode", "yolo",
				"--no-title",
				"--max-time", nodeMaxTime,
				"-p",
				`${commonPrompt}${authorization}`,
			], {
				cwd: projectRoot,
				stdout: "pipe",
				stderr: "pipe",
				env: {
					...process.env,
					PI_AUTO_QA: "0",
					PI_CONFIG_DIR: configRelativeToHome,
					PI_CODING_AGENT_DIR: runtimeAgent,
				},
			});
			const [exitCode, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			await writeFile(logPath, `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}`);
			const after = JSON.parse(await readFile(path.join(nodeResearchRoot, "workflow_state.json"), "utf8")) as JsonObject;
			const traces = await modelChanges(runtimeRoot, startedAtMs);
			const calls = await toolCalls(runtimeRoot, startedAtMs);
			const subagentSessions = await sessionInits(runtimeRoot, startedAtMs);
			await cp(runtimeSessions, sessionsEvidenceRoot, { recursive: true, force: true });
			const stopLock = await exists(path.join(nodeResearchRoot, ".workflow_stop.lock"));
			const validation = Bun.spawn([
				"python3",
				path.join(skillDir, "scripts", "validate_all.py"),
				"--root", nodeResearchRoot,
				"--state", path.join(nodeResearchRoot, "workflow_state.json"),
				"--current-year", "2026",
				"--strict-new-checks",
			], { cwd: nodeResearchRoot, stdout: "pipe", stderr: "pipe", env: { ...process.env, IPH_NO_LOCK: "1" } });
			const [validatorExit, validatorStdout, validatorStderr] = await Promise.all([
				validation.exited,
				new Response(validation.stdout).text(),
				new Response(validation.stderr).text(),
			]);
			const nodeEvidence = {
				node,
				source,
				target,
				ompExit: exitCode,
				validatorExit,
				activeState: after.active_state,
				validityLevel: after.validity_level,
				validationEpoch: after.validation_epoch,
				stopLock,
				modelChanges: traces,
				toolCalls: calls,
				subagentSessions,
				researchRoot: path.relative(runRoot, nodeResearchRoot),
				log: path.relative(runRoot, logPath),
			};
			evidence.nodes.push(nodeEvidence);
			await writeFile(path.join(runRoot, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
			assert(exitCode === 0, `node ${node} OMP exited ${exitCode}; inspect ${logPath}`);
			assert(after.active_state === target, `node ${node} expected ${target}, found ${after.active_state}; STOP=${stopLock}`);
			assert(validatorExit === 0, `node ${node} strict validator exited ${validatorExit}: ${validatorStderr || validatorStdout}`);
			assert(traces.some(item => String(item.model).includes("MiniMax-M3")), `node ${node} lacks runtime M3 model_change evidence`);
			assert(calls.some(item => item.name === "iph_status"), `node ${node} did not call iph_status`);
			assert(calls.some(item => item.name === "iph_transition_plan"), `node ${node} did not call iph_transition_plan`);
			assert(calls.some(item => item.name === "iph_advance"), `node ${node} did not close its edge through iph_advance`);
			if (transitionPlan.specialist) {
				assert(calls.some(item => item.name === "task"), `node ${node} did not dispatch ${transitionPlan.specialist}`);
				assert(
					subagentSessions.some(item => item.agent === transitionPlan.specialist),
					`node ${node} lacks an authenticated ${transitionPlan.specialist} session`,
				);
			}
			if (node === 17 || node === 21) {
				const decisionEvidence = JSON.stringify(after.decision_log ?? []);
				const reviewerTrace = traces.some(item => String(item.model).includes("deepseek-v4-pro"));
				assert(reviewerTrace || decisionEvidence.includes("deepseek-v4-pro"), `node ${node} lacks DeepSeek V4 Pro reviewer evidence`);
				assert(calls.some(item => item.name === "iph_review"), `node ${node} reviewer did not seal through iph_review`);
			}
			process.stdout.write(`REAL_NODE_PASS node=${node} active_state=${after.active_state} validator=0 models=${traces.map(item => item.model).join(",")}\n`);
		}
		evidence.completedAt = new Date().toISOString();
		await writeFile(path.join(runRoot, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
		const nodeRange = allNodes ? "1-22" : "17-22";
		process.stdout.write(`real_model_node_e2e=READY nodes=${nodeRange} final=COMPLETE evidence=${path.join(runRoot, "evidence.json")}\n`);
	}
} finally {
	await rm(runtimeRoot, { recursive: true, force: true });
}
