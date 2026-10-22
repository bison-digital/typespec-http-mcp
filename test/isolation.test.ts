import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { workingTreeFiles } from "./support/working-tree.js";

/**
 * **No two suites may compile into one directory.**
 *
 * Vitest runs test files in parallel and nothing orders them. Two suites compiling one fixture into
 * one directory with different options overwrite each other, and the arms of both then grade
 * whichever compile finished last. In the sibling packages that made one unchanged emitter answer
 * 400, 200 and 204 across three runs -- a suite that races itself is not evidence, and the failure
 * looks exactly like flakiness in the code under test.
 */

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const SELF = "test/isolation.test.ts";

describe("no two suites share a compile destination", () => {
	const suites = workingTreeFiles(packageRoot, "test").filter(
		(name) => name.endsWith(".test.ts") && name !== SELF,
	);

	it("has suites to inspect at all", () => {
		expect(suites.length).toBeGreaterThanOrEqual(5);
	});

	it("claims each sweep directory exactly once", () => {
		const claims = new Map<string, string[]>();
		for (const suite of suites) {
			const text = readFileSync(join(packageRoot, suite), "utf8");
			for (const match of text.matchAll(/compileEmittedSet\("([^"]+)"\)/g)) {
				const name = match[1] ?? "";
				claims.set(name, [...(claims.get(name) ?? []), suite]);
			}
		}
		const shared = [...claims.entries()].filter(([, files]) => files.length > 1);
		expect(shared).toEqual([]);
		// Non-vacuity: a regex that matched nothing would report no sharing either.
		expect(claims.size).toBeGreaterThanOrEqual(2);
	});

	it("claims each fixture output name exactly once", () => {
		const claims = new Map<string, string[]>();
		for (const suite of suites) {
			const text = readFileSync(join(packageRoot, suite), "utf8");
			for (const match of text.matchAll(/outName:\s*"([^"]+)"/g)) {
				const name = match[1] ?? "";
				claims.set(name, [...(claims.get(name) ?? []), suite]);
			}
		}
		const shared = [...claims.entries()].filter(([, files]) => files.length > 1);
		expect(shared).toEqual([]);
		expect(claims.size).toBeGreaterThanOrEqual(2);
	});
});
