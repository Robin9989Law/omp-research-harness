import { PROJECT_ROOT } from "./state";
import type { PlanStep } from "./types";
import { ablationReport } from "./ablation";
import { liveDiagnostics } from "./diagnostics";
import { compileHtir } from "./htir";
import { allocateIsolatedRunRoot, cleanupIsolatedRunRoot, l5TrialsForStep } from "./isolate";
import { elicitationRegression, scoreHtir } from "./scorecard";
import { SCORECARD_SCHEMA } from "./types";

export interface BackendResult {
	ok: boolean;
	output: string;
	exitCode: number;
	isolatedTrials?: number;
	runRoots?: string[];
}

export async function runBackend(step: PlanStep, options?: {
	cwd?: string;
	env?: Record<string, string | undefined>;
	realModels?: boolean;
	ablation?: boolean;
}): Promise<BackendResult> {
	if (step.realModels && !options?.realModels) {
		return { ok: true, exitCode: 0, output: `sif_backend=DEFERRED layer=${step.layer} reason=real-models-not-enabled\n` };
	}
	if (step.ablation && !options?.ablation) {
		return {
			ok: true,
			exitCode: 0,
			output: `sif_backend=DEFERRED layer=L6 informationBudgetHeld=required pairs=steps-vs-invariants,raw-vs-projection,authority-vs-peer,local-vs-global rq3=prompt-only,no-trace,free-edit,no-regression\n`,
		};
	}
	if (step.ablation && options?.ablation) {
		return runAblation(options.env?.SIF_TRACE_ROOT ?? process.env.SIF_TRACE_ROOT);
	}
	if (step.backend === "real-model-nodes") {
		return runIsolatedL5(step, options?.env);
	}
	const cwd = options?.cwd ?? PROJECT_ROOT;
	const commands = commandsFor(step);
	let output = "";
	for (const command of commands) {
		const child = Bun.spawn(command, {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, ...options?.env },
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		output += `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}`;
		if (exitCode !== 0) return { ok: false, output, exitCode };
	}
	return { ok: true, output, exitCode: 0 };
}

async function runIsolatedL5(step: PlanStep, env?: Record<string, string | undefined>): Promise<BackendResult> {
	const fixtureRoot = env?.SIF_FIXTURE_ROOT ?? process.env.SIF_FIXTURE_ROOT;
	if (!fixtureRoot?.trim()) {
		return {
			ok: false,
			exitCode: 1,
			output: "sif_backend=L5 isolated L5 requires SIF_FIXTURE_ROOT; refusing to reuse PROJECT_ROOT as a research run root\n",
		};
	}
	const passK = step.passK ?? 2;
	const runRoots: string[] = [];
	try {
		for (let index = 0; index < passK; index += 1) {
			runRoots.push(await allocateIsolatedRunRoot(`l5-${index}`));
		}
		let trials;
		try {
			trials = l5TrialsForStep(step, {
				fixtureRoot,
				allocateRoot: index => runRoots[index]!,
			});
		} catch (error) {
			return { ok: false, exitCode: 1, output: `sif_backend=L5 ${(error as Error).message}\n`, runRoots };
		}
		let output = `sif_backend=L5 isolated=true passK=${trials.length} runRoots=${runRoots.join(",")}\n`;
		for (const trial of trials) {
			const child = Bun.spawn(trial.command, {
				cwd: PROJECT_ROOT,
				stdout: "pipe",
				stderr: "pipe",
				env: { ...process.env, ...env },
			});
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);
			output += `trial=${trial.index} runRoot=${trial.runRoot}\n${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}`;
			if (exitCode !== 0) {
				return { ok: false, output, exitCode, isolatedTrials: trial.index, runRoots };
			}
		}
		return { ok: true, output, exitCode: 0, isolatedTrials: trials.length, runRoots };
	} finally {
		await Promise.all(runRoots.map(root => cleanupIsolatedRunRoot(root)));
	}
}

async function runAblation(traceRoot?: string): Promise<BackendResult> {
	const rq3Only = !traceRoot;
	if (rq3Only) {
		const report = ablationReport({
			outcomeReady: false,
			scorecard: {
				schema: SCORECARD_SCHEMA,
				loops: [],
				invalidToolCalls: 0,
				informationBudgetHeld: true,
				scaffoldThickness: 0,
			},
		});
		const held = report.rq3.gatesAreLoadBearing && report.rq3.informationBudgetHeld;
		return {
			ok: held,
			exitCode: held ? 0 : 1,
			output: `sif_backend=L6 trace=absent ${JSON.stringify({ ladder: report, rq3: report.rq3 })}\n`,
		};
	}
	const htir = await compileHtir({ traceRoot });
	const scorecard = scoreHtir(htir);
	const diagnostics = liveDiagnostics(htir);
	const processIssue = elicitationRegression(scorecard, { htir });
	const report = ablationReport({ outcomeReady: false, scorecard, diagnostics, processIssue });
	const held = report.informationBudgetHeld
		&& !report.h1InvalidTools
		&& !report.h2SkipOrPendingOrHubWait
		&& report.rq3.gatesAreLoadBearing;
	return {
		ok: held,
		exitCode: held ? 0 : 1,
		output: `sif_backend=L6 ${JSON.stringify(report)}\n`,
	};
}

export function commandsFor(step: PlanStep): string[][] {
	switch (step.backend) {
		case "typecheck+system-matrix":
			return [["bun", "run", "typecheck"], ["bun", "run", "test:system"]];
		case "bun-test":
			return [["bun", "test"]];
		case "omp-e2e":
			return [["bun", "run", "test:omp"]];
		case "install+package-check":
			return [["bun", "run", "test:install"], ["bun", "scripts/check-package.ts"]];
		case "test-nodes":
			return [["bun", "run", "test:nodes"]];
		case "real-model-nodes":
			return [];
		case "scaffold-ablation":
			return [];
		default:
			throw new Error(`unknown backend ${step.backend}`);
	}
}
