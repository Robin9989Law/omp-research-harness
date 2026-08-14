import { readFile } from "node:fs/promises";
import { IMPACT_FILE } from "./state";
import { LAYERS, type DeltaClass, type ImpactResult, type ImpactSurface, type Layer } from "./types";

export function globMatch(pattern: string, file: string): boolean {
	const normalized = file.replaceAll("\\", "/");
	const body = pattern
		.replaceAll(/[.+^${}()|[\]\\]/g, "\\$&")
		.replaceAll("**", "\u0000")
		.replaceAll("*", "[^/]*")
		.replaceAll("\u0000", ".*");
	return new RegExp(`^${body}$`).test(normalized);
}

export async function loadImpactSurfaces(file = IMPACT_FILE): Promise<ImpactSurface[]> {
	const parsed = Bun.YAML.parse(await readFile(file, "utf8")) as { surfaces?: ImpactSurface[] };
	const surfaces = parsed.surfaces ?? [];
	if (surfaces.length === 0) throw new Error("impact.yml has no surfaces");
	return surfaces;
}

export function classifyFiles(files: string[], surfaces: ImpactSurface[]): ImpactResult {
	const layers = new Set<Layer>();
	const nodes = new Set<number>();
	const failures = new Set<string>();
	const classes = new Set<DeltaClass>();
	const unknownFiles: string[] = [];
	let ablation = false;
	let nodesRequired = false;

	for (const file of files) {
		const hits = surfaces.filter(surface => globMatch(surface.match, file.replaceAll("\\", "/")));
		if (hits.length === 0) {
			unknownFiles.push(file);
			for (const layer of ["L0", "L1", "L2", "L3", "L4"] as const) layers.add(layer);
			classes.add("unknown");
			continue;
		}
		for (const hit of hits) {
			for (const layer of hit.layers) layers.add(layer);
			for (const node of hit.nodes) nodes.add(node);
			for (const failure of hit.failures) failures.add(failure);
			for (const deltaClass of hit.classes) classes.add(deltaClass);
			ablation ||= hit.ablation;
			nodesRequired ||= Boolean(hit.nodesRequired);
		}
	}

	return {
		layers: LAYERS.filter(layer => layers.has(layer)),
		nodes: [...nodes].sort((left, right) => left - right),
		failures: [...failures].sort(),
		ablation,
		classes: [...classes],
		nodesRequired,
		unknownFiles,
	};
}
