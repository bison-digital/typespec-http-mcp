import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileFixture } from "./compile-fixture.js";

/**
 * **A deterministic set of emitted output, compiled by the suite that grades it.**
 *
 * In the sibling packages three oracles walked `test/` for emitted output written by OTHER test
 * files. Vitest runs test files in parallel and nothing ordered them, so each graded whatever the
 * previous run had left behind. Reproducible in both directions there: a clean tree failed with
 * every floor at zero, and a populated tree passed by grading the *previous* build -- including a
 * control that deleted a fix from `src/` and still went green.
 *
 * **Each caller gets its OWN directory**, and `isolation.test.ts` asserts no two share one.
 */

// `../..` because this file lives in `test/support/`, where `..` is `test/` and not the root.
const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * The fixtures compiled for these sweeps. Every `.tsp` this package owns, so a sweep cannot be
 * narrower than the emitter's own surface. Listing them here makes adding one to the sweep a
 * deliberate act rather than an omission.
 */
export const SWEPT_FIXTURES: readonly (readonly [dir: string, name: string])[] = [
	["reference", "service"],
];

/** Every `.gen.ts` under a directory. */
export function generatedFilesUnder(root: string): string[] {
	const found: string[] = [];
	const walk = (dir: string): void => {
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) walk(full);
			else if (entry.endsWith(".gen.ts")) found.push(full);
		}
	};
	walk(root);
	return found;
}

/** Compile {@link SWEPT_FIXTURES} into a directory of this caller's own. `outName` must be unique. */
export async function compileEmittedSet(outName: string): Promise<string[]> {
	const outputRoot = join(packageRoot, "test", `.out-${outName}`);
	rmSync(outputRoot, { recursive: true, force: true });
	for (const [dir, name] of SWEPT_FIXTURES) {
		await compileFixture(join(packageRoot, "test", dir), name, {
			outDir: join(outputRoot, `${dir}__${name}`),
		});
	}
	return generatedFilesUnder(outputRoot);
}
