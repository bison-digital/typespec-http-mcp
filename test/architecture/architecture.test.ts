import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **The boundaries, pinned rather than merely tidy once.**
 *
 * Three of these were live when this suite was written: the renderer transitively depended on the
 * TypeSpec compiler because two derivation modules also rendered text; the package name was written
 * twice, so a drift would have silently disabled the collision check; and nothing stopped the module
 * that is COPIED INTO CONSUMER OUTPUT from importing a build-time package.
 *
 * That last one is the reason this file exists at all. Everything else here is hygiene; that one is
 * a broken install for every consumer, discovered at deploy time.
 */

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const srcDir = join(packageRoot, "src");

/** Imports as the compiler sees them: comments and template literals stripped first. */
function importsOf(file: string): string[] {
	const raw = readFileSync(join(srcDir, file), "utf8");
	const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/`(?:[^`\\]|\\.)*`/gs, "``");
	return [...code.matchAll(/^\s*(?:import|export)\s[\s\S]*?from\s+"([^"]+)"/gm)].map(
		(match) => match[1] ?? "",
	);
}

const MODULES = readdirSync(srcDir).filter((name) => name.endsWith(".ts"));

/** Every external package a module reaches, following local imports. */
function externalClosure(file: string, seen = new Set<string>()): Set<string> {
	for (const specifier of importsOf(file)) {
		if (specifier.startsWith("./")) {
			const local = `${specifier.slice(2).replace(/\.js$/, ".ts")}`;
			if (!seen.has(local)) {
				seen.add(local);
				externalClosure(local, seen);
			}
		} else if (!specifier.startsWith("node:")) {
			seen.add(specifier);
		}
	}
	return seen;
}

const externalsOf = (file: string) =>
	[...externalClosure(file)].filter((name) => !name.endsWith(".ts")).toSorted();

describe("the module graph is inspectable at all", () => {
	it("found the modules it grades", () => {
		expect(MODULES.length).toBeGreaterThanOrEqual(10);
		expect(MODULES).toContain("runtime.ts");
		expect(MODULES).toContain("tools.ts");
	});

	it("has no import cycle", () => {
		const cycles: string[] = [];
		for (const file of MODULES) {
			const reached = externalClosure(file);
			if (reached.has(file)) cycles.push(file);
		}
		expect(cycles).toEqual([]);
	});
});

describe("runtime.ts is consumer code and must stay that way", () => {
	/**
	 * It is read off disk and written verbatim into the consumer's output directory, so anything it
	 * imports becomes an import in THEIR build. A build-time package there is a broken deploy.
	 */
	it("imports only packages a consumer installs", () => {
		expect(externalsOf("runtime.ts")).toEqual(["@modelcontextprotocol/server", "zod"]);
	});

	/**
	 * **And no Node builtin, which the closure above is written not to see.**
	 *
	 * `externalClosure` skips every `node:` specifier, because `emitter.ts` legitimately reads the
	 * filesystem and grading it for that would be noise. That exclusion is exactly wrong for this one
	 * module: it is copied verbatim into a consumer's Workers build, where `node:fs` is
	 * `Uncaught Error: No such module "node:fs"` unless they set `nodejs_compat` -- a flag this
	 * package must not oblige anybody to set.
	 *
	 * **Measured, and it is why this arm exists.** `node:fs` was planted in `src/runtime.ts` and this
	 * suite stayed green on all ten arms while `test/socket/socket.test.ts` failed on five. The rule
	 * whose whole purpose is "only what a consumer installs" could not see the one specifier class
	 * that breaks a deploy.
	 */
	it("imports no Node builtin, because a Worker has none without a compatibility flag", () => {
		expect(importsOf("runtime.ts").filter((name) => name.startsWith("node:"))).toEqual([]);
		// Non-vacuity: a file this read as empty would report no builtins either.
		expect(importsOf("runtime.ts").length).toBeGreaterThanOrEqual(2);
	});

	it("imports no other module of this package, so copying it out is lossless", () => {
		expect(importsOf("runtime.ts").filter((s) => s.startsWith("./"))).toEqual([]);
	});

	it("is the file the emitter actually copies", () => {
		const emitter = readFileSync(join(srcDir, "emitter.ts"), "utf8");
		expect(emitter).toContain('new URL("../../src/runtime.ts", import.meta.url)');
	});
});

describe("the renderer renders, and the derivations derive", () => {
	/**
	 * `tools.ts` produces text. It once reached `@typespec/compiler` and `@typespec/http`
	 * transitively, because `security.ts` declared both a program-reading derivation and the
	 * `JSON.stringify` that fed its output into a template.
	 */
	it("the renderer never reaches the TypeSpec compiler, even transitively", () => {
		const externals = externalsOf("tools.ts");
		expect(externals).not.toContain("@typespec/compiler");
		expect(externals).not.toContain("@typespec/http");
		// Non-vacuity: it does reach something, so the closure is being computed.
		expect(externals.length).toBeGreaterThanOrEqual(2);
	});

	it("the pure derivations stay pure", () => {
		for (const file of ["annotations.ts", "names.ts", "statuses.ts"]) {
			expect(externalsOf(file), file).toEqual([]);
		}
		// The body kinds read the library's published response records and nothing else, so the
		// renderer and the refusals can share them without either reaching the compiler through them.
		expect(externalsOf("bodies.ts")).toEqual(["typespec-http-zod"]);
	});

	it("only the orchestrator imports the orchestrator", () => {
		const importers = MODULES.filter(
			(file) => file !== "emitter.ts" && importsOf(file).some((s) => s === "./emitter.js"),
		);
		expect(importers).toEqual(["index.ts"]);
	});
});

describe("facts are declared once", () => {
	/**
	 * The name is how `coexistence.ts` finds this emitter in the compiler's own options map. A second
	 * literal that drifted would find nothing and report no collision -- a guard that stops running
	 * with nothing to say so.
	 */
	it("the package name is a literal in exactly one module", () => {
		const declaring = MODULES.filter((file) =>
			readFileSync(join(srcDir, file), "utf8").includes('"typespec-http-mcp"'),
		);
		expect(declaring).toEqual(["lib.ts"]);
	});

	it("and it matches what package.json publishes", () => {
		const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
			name: string;
		};
		expect(readFileSync(join(srcDir, "lib.ts"), "utf8")).toContain(
			`export const PACKAGE_NAME = "${manifest.name}"`,
		);
	});
});
