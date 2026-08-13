export interface NpmPackEntry {
	filename?: string;
}

export function parseNpmPackOutput(output: string): NpmPackEntry[] {
	const parsed = JSON.parse(output) as unknown;
	const candidates = Array.isArray(parsed)
		? parsed
		: parsed && typeof parsed === "object"
			? Object.values(parsed)
			: [];
	return candidates.filter((entry): entry is NpmPackEntry => Boolean(entry) && typeof entry === "object");
}
