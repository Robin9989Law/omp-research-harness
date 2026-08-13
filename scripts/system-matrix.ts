import { readFile } from "node:fs/promises";
import * as path from "node:path";
import {
	auditSystemTopology,
	POSITIVE_STATE_SEQUENCE,
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
} as const;

for (const [agent, role] of Object.entries(expectedAgents)) {
	const contents = await readFile(path.join(root, "agents", `${agent}.md`), "utf8");
	assert(contents.includes(`model: "@${role}"`), `${agent} is not routed through @${role}`);
	assert(typeof roles[role] === "string" && roles[role]!.length > 0, `model role ${role} is missing`);
}
assert(roles.default?.includes("MiniMax-M3"), "default coordinator must remain MiniMax-M3");
assert(roles.commit === roles.default, "commit and coordinator must share the M3 selector");

const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
assert(packageJson.version === packageJson.omp?.version, "package and OMP versions drifted");
const skillLock = JSON.parse(await readFile(path.join(root, "config", "iph-lock.json"), "utf8"));
assert(/^[0-9a-f]{40}$/.test(skillLock.commit), "authoritative skill commit is not pinned");

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
	`specialist_edges=${specialistEdges} negative_terminals=2 failure_injections=10 package=${packageJson.version} ` +
	`skill=${skillLock.commit}\n`,
);
