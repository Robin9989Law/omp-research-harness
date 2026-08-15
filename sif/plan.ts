import type { ImpactResult, Layer, PlanStep } from "./types";

const BACKENDS: Record<string, string> = {
	L0: "typecheck+system-matrix",
	L1: "bun-test+iph-pytest",
	L2: "omp-e2e",
	L3: "recovery-inject",
	L4: "install+package-check",
	L5: "real-model-nodes",
	L6: "scaffold-ablation",
};

export function impactSignature(impact: ImpactResult, files: string[]): string {
	return JSON.stringify({
		files: [...files].sort(),
		layers: impact.layers,
		nodes: impact.nodes,
		failures: impact.failures,
		ablation: impact.ablation,
		nodesRequired: impact.nodesRequired,
		unknown: impact.unknownFiles,
	});
}

export function buildPlan(impact: ImpactResult, options?: { passK?: number; extraLayers?: Layer[] }): { steps: PlanStep[]; deferred: Array<"L5" | "L6"> } {
	const steps: PlanStep[] = [];
	const deferred: Array<"L5" | "L6"> = [];
	const layers = new Set(impact.layers);
	for (const layer of options?.extraLayers ?? []) layers.add(layer);
	if (impact.unknownFiles.length > 0) {
		for (const layer of ["L0", "L1", "L2", "L3", "L4"] as const) layers.add(layer);
	}
	if (impact.nodesRequired) layers.add("L1");

	const add = (layer: Layer, extras: Partial<PlanStep> = {}) => {
		steps.push({
			id: `${layer}-${BACKENDS[layer]}`,
			layer,
			backend: BACKENDS[layer]!,
			oracle: layer === "L5" || layer === "L6" ? "both" : "outcome",
			...extras,
		});
	};

	for (const layer of ["L0", "L1"] as const) {
		if (layers.has(layer)) add(layer, { failures: impact.failures });
	}
	if (layers.has("L2")) add("L2", { failures: impact.failures });
	if (layers.has("L3")) add("L3", { failures: impact.failures });
	if (layers.has("L4")) add("L4", { failures: impact.failures });
	if (impact.nodesRequired) {
		steps.push({
			id: "nodes-deterministic",
			layer: "L1",
			backend: "test-nodes",
			oracle: "outcome",
			failures: impact.failures,
		});
	}
	if (layers.has("L5") || impact.nodes.length > 0) {
		deferred.push("L5");
		steps.push({
			id: "L5-real-models",
			layer: "L5",
			backend: BACKENDS.L5!,
			oracle: "both",
			nodes: impact.nodes.length > 0 ? impact.nodes : undefined,
			realModels: true,
			passK: options?.passK ?? 2,
			failures: impact.failures,
		});
	}
	if (impact.ablation || layers.has("L6")) {
		deferred.push("L6");
		steps.push({
			id: "L6-ablation",
			layer: "L6",
			backend: BACKENDS.L6!,
			oracle: "process",
			ablation: true,
			nodes: impact.nodes,
			failures: impact.failures,
		});
	}
	return { steps, deferred: [...new Set(deferred)] };
}
