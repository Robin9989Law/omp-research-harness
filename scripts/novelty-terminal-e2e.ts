import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { loadExtensions } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { EventBus } from "@oh-my-pi/pi-coding-agent/utils/event-bus";
import { N0_REQUIRED_NEXT_ACTIONS } from "../extensions/iph";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const fixtureRoot = path.resolve(process.argv[2] ?? "");
assert(fixtureRoot && await Bun.file(path.join(fixtureRoot, "evidence_validate", "workflow_state.json")).exists(),
	"usage: bun scripts/novelty-terminal-e2e.ts <generated-agent-node-fixture-root>");
const projectRoot = path.resolve(import.meta.dir, "..");

for (const novelty of ["N0-1", "N0-2", "N0-3"] as const) {
	const root = await mkdtemp(path.join(tmpdir(), `iph-${novelty.toLowerCase()}-`));
	try {
		await cp(path.join(fixtureRoot, "evidence_validate"), root, { recursive: true });
		const evidence = novelty === "N0-1"
			? "# Novelty audit\n\n## 占据证据（occupation evidence）\n\n- [占据] W-0001 §1.1 Eq. (4) directly occupies the candidate method claim.\n"
			: novelty === "N0-2"
				? "# Novelty audit\n\n## 归约证据（reduction evidence）\n\n- [归约] W-0001 §1.1 Eq. (4) plus §2.1 Theorem 1 mechanically imply the bounded candidate claim.\n"
				: "# Novelty audit\n\nThe current evidence leaves a bounded unresolved novelty hold; revise or start another collision round.\n";
		await writeFile(path.join(root, "novelty-audit.md"), evidence);
		const eventBus = new EventBus();
		const loaded = await loadExtensions([path.join(projectRoot, "extensions", "iph.ts")], root, eventBus);
		assert(loaded.errors.length === 0 && loaded.extensions.length === 1, `extension load failed for ${novelty}`);
		const extension = loaded.extensions[0]!;
		const sessionFile = path.join(root, `${novelty}.jsonl`);
		const ctx = {
			cwd: root,
			getSystemPrompt: () => [],
			sessionManager: { getSessionId: () => novelty, getSessionFile: () => sessionFile },
		} as unknown as ExtensionContext;
		const execute = async (name: string, params: Record<string, unknown>) => {
			const tool = extension.tools.get(name);
			assert(tool, `missing ${name}`);
			return tool.definition.execute(`call-${name}`, params as never, undefined, undefined, ctx);
		};
		const result = await execute("iph_advance", {
			to: "N0_AUDIT",
			note: `record the evidence-grounded ${novelty} verdict`,
			gates: ["n0_4_locked=false"],
			artifacts: ["novelty-audit.md"],
			stateArtifacts: ["hierarchy_novelty_audit=novelty-audit.md"],
			nextAction: N0_REQUIRED_NEXT_ACTIONS[novelty],
			noveltyLevel: novelty,
			strict: true,
		});
		assert(!result.isError, `${novelty} verdict failed: ${JSON.stringify(result)}`);
		const statePath = path.join(root, "workflow_state.json");
		const stateBytes = await readFile(statePath, "utf8");
		const state = JSON.parse(stateBytes);
		assert(state.active_state === "N0_AUDIT" && state.novelty_level === novelty, `${novelty} state mismatch`);
		assert(state.gates.n0_4_locked === false, `${novelty} incorrectly locked a positive claim`);
		const plan = await execute("iph_transition_plan", {});
		assert(!plan.isError, `${novelty} terminal plan was not readable`);
		assert(plan.content.some(item => item.type === "text" && item.text.includes('"terminal": true')),
			`${novelty} did not report a terminal/hold contract`);
		const forced = await execute("iph_advance", {
			to: "CLAIM_FREEZE",
			note: "forbidden forced positive continuation",
			gates: [],
			artifacts: ["claim-freeze.md"],
			stateArtifacts: [],
			nextAction: "Complete CLAIM_FREEZE and advance exactly once to VALIDITY_AUDIT.",
			strict: true,
		});
		assert(forced.isError, `${novelty} terminal incorrectly advanced to CLAIM_FREEZE`);
		assert(await readFile(statePath, "utf8") === stateBytes, `${novelty} forced continuation mutated state`);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

process.stdout.write("novelty_terminal_e2e=READY verdicts=N0-1+N0-2 hold=N0-3 forced_positive=blocked state=byte-stable\n");
