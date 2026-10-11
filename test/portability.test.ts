import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { workingTreeFiles } from "./support/working-tree.js";
import { compileEmittedSet } from "./support/emitted-set.js";

/**
 * **Nothing that ships names a path that exists on one machine, or a place this emitter does not own.**
 *
 * **The emitted output is the half that matters, and no other arm reads it for this.** A generated
 * file carrying `/Users/somebody/projects/...` compiles for the person who ran the emitter and for
 * nobody else -- and generated output is committed by the consumer. `contracts-package` takes a
 * specifier that lands verbatim in the output, so an absolute one is a single mis-set option away.
 *
 * **This is a companion to "every import resolves", not a subset of it.** An absolute specifier
 * RESOLVES, on the machine that wrote it, which is exactly why a resolution check cannot see it.
 *
 * Home directories are matched by SHAPE rather than by this machine's own path, so the guard means
 * the same thing wherever it runs; keying it on `process.env.HOME` would pass on any other machine.
 */

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

/** An absolute path into somebody's checkout, in the forms the three platforms spell it. */
const MACHINE_PATHS = [
	/\/Users\/[^/\s"']+\//,
	/\/home\/[^/\s"']+\//,
	/\b[A-Za-z]:\\\\?Users\\\\?/,
	/\bfile:\/\/\/[A-Za-z]/,
];

/**
 * **New here, with no counterpart in the sibling emitters: a transport is not this emitter's to
 * choose.**
 *
 * The consumer owns the `McpServer`, the transport and the authentication in front of it. A
 * loopback URL with a port, or a `/mcp` route literal, in generated output is the emitter making a
 * deployment decision on their behalf -- one they cannot change without editing a file that is
 * overwritten on the next compile.
 */
const TRANSPORT_LITERALS = [/https?:\/\//, /\blocalhost\b/, /:\d{4,5}\b/, /"\/mcp"/];

function offendersIn(label: string, text: string, patterns: readonly RegExp[]): string[] {
	return patterns.flatMap((pattern) => {
		const match = pattern.exec(text);
		return match === null ? [] : [`${label}: ${match[0]}`];
	});
}

let emitted: string[] = [];

beforeAll(async () => {
	emitted = await compileEmittedSet("portability");
}, 900_000);

describe("nothing this package ships names one machine's filesystem", () => {
	const tracked = workingTreeFiles(packageRoot);

	it("has files to inspect at all", () => {
		expect(tracked.length).toBeGreaterThanOrEqual(15);
	});

	it("carries no machine path in any tracked file", () => {
		const offenders = tracked.flatMap((name) => {
			// This file spells every forbidden shape by definition.
			if (name === "test/portability.test.ts") return [];
			try {
				return offendersIn(name, readFileSync(`${packageRoot}/${name}`, "utf8"), MACHINE_PATHS);
			} catch {
				return [];
			}
		});
		expect(offenders).toEqual([]);
	});

	it("carries no machine path in anything the emitter GENERATES", () => {
		// Tracked files are reviewed when they change; generated files are written fresh on every
		// compile from whatever options the consumer set, and are then committed to their repository.
		expect(emitted.length).toBeGreaterThanOrEqual(1);
		const offenders = emitted.flatMap((file) =>
			offendersIn(file.slice(packageRoot.length), readFileSync(file, "utf8"), MACHINE_PATHS),
		);
		expect(offenders).toEqual([]);
	});

	it("names no host, port or transport in anything the emitter GENERATES", () => {
		expect(emitted.length).toBeGreaterThanOrEqual(1);
		const offenders = emitted.flatMap((file) =>
			offendersIn(file.slice(packageRoot.length), readFileSync(file, "utf8"), TRANSPORT_LITERALS),
		);
		expect(offenders).toEqual([]);
	});

	/**
	 * **Generated files cite no file of this package.** The runtime's docblocks named the tests that
	 * grade it, `test/...test.ts`, and the runtime is copied into the consumer's tree, where those
	 * paths do not exist: a consumer whose own guard checks that every cited file exists failed on
	 * them. A suite is named in prose instead.
	 */
	it("cites no path of this package's own in anything the emitter GENERATES", () => {
		expect(emitted.length).toBeGreaterThanOrEqual(1);
		const cited = emitted.flatMap((file) =>
			[...readFileSync(file, "utf8").matchAll(/\btest\/[\w./-]+\.ts\b/g)].map(
				(match) => `${file.slice(packageRoot.length)}: ${match[0]}`,
			),
		);
		expect(cited).toEqual([]);
	});

	it("emits ASCII only", () => {
		const offenders = emitted.flatMap((file) => {
			const text = readFileSync(file, "utf8");
			// eslint-disable-next-line no-control-regex
			const match = /[^\x00-\x7F]/.exec(text);
			if (match === null) return [];
			const codepoint = match[0].codePointAt(0)?.toString(16) ?? "?";
			// Reported as a codepoint: a bare "non-ASCII found" sends the reader hunting.
			return [`${file.slice(packageRoot.length)}: U+${codepoint.toUpperCase()}`];
		});
		expect(offenders).toEqual([]);
	});
});
