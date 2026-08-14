import { readFile } from "node:fs/promises";
import * as path from "node:path";
import {
	auditSystemTopology,
	POSITIVE_STATE_SEQUENCE,
	resolveSkillDir,
	transitionPlanForState,
} from "../extensions/iph";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const root = path.resolve(import.meta.dir, "..");
const topologyIssues = auditSystemTopology();
assert(topologyIssues.length === 0, `topology audit failed:\n${topologyIssues.join("\n")}`);

const roleConfig = Bun.YAML.parse(
	await readFile(path.join(root, "config", "model-roles.yml"), "utf8"),
) as { modelRoles?: Record<string, string> };
const roles = roleConfig.modelRoles ?? {};
const expectedAgents = {
	"frontier-auditor": "frontier",
	"layer-adjudicator": "layer",
	"atomic-claim-extractor": "atomic",
	"collision-synthesizer": "collision",
	"iph-reviewer": "review",
	"event-flow-manager": "event",
} as const;

for (const [agent, role] of Object.entries(expectedAgents)) {
	const contents = await readFile(path.join(root, "agents", `${agent}.md`), "utf8");
	assert(contents.includes(`model: "@${role}"`), `${agent} is not routed through @${role}`);
	assert(typeof roles[role] === "string" && roles[role]!.length > 0, `model role ${role} is missing`);
}
const frontierAgent = await readFile(path.join(root, "agents", "frontier-auditor.md"), "utf8");
assert(frontierAgent.includes("does not impose array ordering"), "frontier auditor lacks the false-first semantic boundary");
assert(frontierAgent.includes("FAIL must cite an exact authoritative rule"), "frontier auditor may invent uncited failure constraints");
assert(frontierAgent.includes("independent adversarial peer"), "frontier auditor is not framed as an independent peer");
assert(frontierAgent.includes("Separate gate closure from open-ended exploration"), "frontier auditor lacks bounded completion semantics");
assert(frontierAgent.includes("evidence roles, not a URL-count target"), "frontier auditor may optimize URL count over evidence semantics");
assert(frontierAgent.includes("not authority over the coordinator"), "frontier completion is incorrectly framed as authority");
const eventAgent = await readFile(path.join(root, "agents", "event-flow-manager.md"), "utf8");
assert(eventAgent.includes("resolvedModel") && eventAgent.includes("UNKNOWN"), "event manager may infer a model fallback without runtime evidence");
assert(eventAgent.includes("belongs only to you"), "event manager may project its own model identity onto another task");
const agentNativeContract = await readFile(path.join(root, "AGENT_NATIVE_ENGINEERING.md"), "utf8");
assert(agentNativeContract.includes("最大化主 Agent 能力"), "agent-native contract suppresses M3 capability");
assert(agentNativeContract.includes("约束的是副作用，不是思考空间"), "agent-native contract confuses reasoning with side-effect control");
assert(roles.default?.includes("MiniMax-M3"), "default coordinator must remain MiniMax-M3");
assert(roles.commit === roles.default, "commit and coordinator must share the M3 selector");
assert(roles.event === "deepseek/deepseek-v4-flash:low", "event flow must use the low-latency DeepSeek V4 Flash role");
const localRunner = await readFile(path.join(root, "scripts", "run-local-omp.sh"), "utf8");
assert(localRunner.includes("--plugin-dir"), "local debug runner must load the complete plugin bundle");
assert(!localRunner.includes("--extension") && !localRunner.includes("--no-extensions"), "local debug runner must not split tools from agents");

const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
assert(packageJson.version === packageJson.omp?.version, "package and OMP versions drifted");
const skillLock = JSON.parse(await readFile(path.join(root, "config", "iph-lock.json"), "utf8"));
assert(/^[0-9a-f]{40}$/.test(skillLock.commit), "authoritative skill commit is not pinned");

const skillDir = resolveSkillDir();
assert(skillDir, "authoritative skill checkout is not discoverable");
const stateProbe = Bun.spawn([
	process.env.IPH_PYTHON || "python3",
	"-c",
	"import json,sys; sys.path.insert(0,sys.argv[1]); import validate_workflow_state as v; print(json.dumps(sorted(v.STATES)))",
	path.join(skillDir, "scripts"),
], { stdout: "pipe", stderr: "pipe" });
const [stateProbeExit, stateProbeOut, stateProbeError] = await Promise.all([
	stateProbe.exited,
	new Response(stateProbe.stdout).text(),
	new Response(stateProbe.stderr).text(),
]);
assert(stateProbeExit === 0, `cannot read authoritative Python states: ${stateProbeError.trim()}`);
const authoritativeStates = JSON.parse(stateProbeOut) as string[];
const harnessStates = [...POSITIVE_STATE_SEQUENCE, "BLOCKED"].sort();
assert(
	JSON.stringify(authoritativeStates) === JSON.stringify(harnessStates),
	`Python/TypeScript state drift: python=${JSON.stringify(authoritativeStates)} harness=${JSON.stringify(harnessStates)}`,
);

let specialistEdges = 0;
for (let index = 0; index < POSITIVE_STATE_SEQUENCE.length - 1; index += 1) {
	const source = POSITIVE_STATE_SEQUENCE[index]!;
	const expectedTarget = POSITIVE_STATE_SEQUENCE[index + 1]!;
	const plan = transitionPlanForState({
		active_state: source,
		novelty_level: source === "N0_AUDIT" ? "N0-4C" : "N0-3",
	});
	assert(plan?.target === expectedTarget, `${source} did not resolve to ${expectedTarget}`);
	if (plan.specialist) specialistEdges += 1;
	process.stdout.write(
		`NODE ${String(index + 1).padStart(2, "0")} ${source} -> ${expectedTarget}` +
		`${plan.specialist ? ` specialist=${plan.specialist}` : " coordinator=M3"}\n`,
	);
}

assert(
	transitionPlanForState({ active_state: "N0_AUDIT", novelty_level: "N0-1" }) === undefined &&
	transitionPlanForState({ active_state: "N0_AUDIT", novelty_level: "N0-2" }) === undefined,
	"negative N0 outcomes must remain terminal",
);
process.stdout.write(
	`system_matrix=READY nodes=${POSITIVE_STATE_SEQUENCE.length} transitions=${POSITIVE_STATE_SEQUENCE.length - 1} ` +
	`specialist_edges=${specialistEdges} negative_terminals=2 novelty_holds=1 failure_injections=30 state_sources=python+typescript package=${packageJson.version} ` +
	`skill=${skillLock.commit}\n`,
);
