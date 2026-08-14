import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { PlanStep } from "./types";

export interface IsolatedTrial {
	index: number;
	runRoot: string;
	command: string[];
}

/**
 * Harbor-style one-shot run root. `test:models --run-root` must not already exist,
 * so this returns a child path under a fresh parent.
 */
export async function allocateIsolatedRunRoot(label: string): Promise<string> {
	const parent = await mkdtemp(path.join(tmpdir(), `sif-${label.replace(/[^a-zA-Z0-9_-]/g, "")}-`));
	return path.join(parent, "trial");
}

export function l5IsolatedTrials(options: {
	fixtureRoot?: string;
	passK: number;
	nodes?: number[];
	allocateRoot: (index: number) => string;
}): IsolatedTrial[] {
	const fixtureRoot = options.fixtureRoot?.trim();
	if (!fixtureRoot) {
		throw new Error("isolated L5 requires SIF_FIXTURE_ROOT; refusing to reuse PROJECT_ROOT as a research run root");
	}
	if (!Number.isInteger(options.passK) || options.passK < 1) {
		throw new Error("pass^k must be a positive integer");
	}
	const trials: IsolatedTrial[] = [];
	for (let index = 0; index < options.passK; index += 1) {
		const runRoot = options.allocateRoot(index);
		if (!runRoot || runRoot === process.cwd()) {
			throw new Error("isolated L5 trial run-root must be a unique empty path, not cwd");
		}
		const command = [
			"bun",
			"run",
			"test:models",
			"--",
			"--fixture-root",
			fixtureRoot,
			"--run-root",
			runRoot,
		];
		if (options.nodes && options.nodes.length > 0) {
			const from = Math.min(...options.nodes);
			const to = Math.max(...options.nodes);
			command.push("--all-nodes", "--from-node", String(from), "--to-node", String(to));
		}
		trials.push({ index, runRoot, command });
	}
	return trials;
}

export function l5TrialsForStep(step: PlanStep, options: {
	fixtureRoot?: string;
	allocateRoot: (index: number) => string;
}): IsolatedTrial[] {
	return l5IsolatedTrials({
		fixtureRoot: options.fixtureRoot,
		passK: step.passK ?? 2,
		nodes: step.nodes,
		allocateRoot: options.allocateRoot,
	});
}
