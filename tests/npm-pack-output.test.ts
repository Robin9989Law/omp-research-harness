import { describe, expect, test } from "bun:test";
import { parseNpmPackOutput } from "../scripts/npm-pack-output";

describe("npm pack JSON compatibility", () => {
	test("accepts the npm 11 array shape", () => {
		expect(parseNpmPackOutput('[{"filename":"package-0.0.1.tgz"}]')).toEqual([
			{ filename: "package-0.0.1.tgz" },
		]);
	});

	test("accepts the npm 12 package-keyed object shape", () => {
		expect(parseNpmPackOutput('{"@scope/package":{"filename":"scope-package-0.0.1.tgz"}}')).toEqual([
			{ filename: "scope-package-0.0.1.tgz" },
		]);
	});
});
