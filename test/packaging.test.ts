import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileEmittedSet } from "./support/emitted-set.js";

/**
 * **That the package declares what it needs to run outside this checkout.**
 *
 * A dependency that resolves here because a sibling happened to install it, or an emitted import
 * naming a package the consumer was never told to add, both work perfectly until the first person
 * installs this from the registry. That is the one arrangement this repository cannot reproduce by
 * accident, so it is asserted rather than trusted.
 */

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	exports: Record<string, Record<string, string>>;
	files: string[];
	publishConfig?: { access?: string; provenance?: boolean };
	license?: string;
	repository?: unknown;
};

/** `@scope/name/sub` -> `@scope/name`; `pkg/sub` -> `pkg`. Node builtins are not packages. */
function packageOf(specifier: string): string | undefined {
	if (specifier.startsWith(".") || specifier.startsWith("node:")) return undefined;
	const parts = specifier.split("/");
	return specifier.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

function importsIn(text: string): string[] {
	const found = new Set<string>();
	for (const match of text.matchAll(/(?:from|import)\s+"([^"]+)"/g)) {
		const name = packageOf(match[1] ?? "");
		if (name !== undefined) found.add(name);
	}
	return [...found];
}

const declared = new Set([
	...Object.keys(manifest.dependencies ?? {}),
	...Object.keys(manifest.peerDependencies ?? {}),
]);

let emitted: string[] = [];
beforeAll(async () => {
	emitted = await compileEmittedSet("packaging");
}, 900_000);

describe("the package declares what it needs to run outside this checkout", () => {
	const sources = execFileSync("git", ["ls-files", "src"], { cwd: packageRoot, encoding: "utf8" })
		.split("\n")
		.filter((name) => name.endsWith(".ts"));

	it("has source to inspect at all", () => {
		expect(sources.length).toBeGreaterThanOrEqual(4);
	});

	it("declares every package `src/` imports", () => {
		const undeclared = sources
			.flatMap((name) => importsIn(readFileSync(join(packageRoot, name), "utf8")))
			.filter((name) => !declared.has(name));
		expect([...new Set(undeclared)]).toEqual([]);
	});

	it("declares every package the GENERATED output imports", () => {
		expect(emitted.length).toBeGreaterThanOrEqual(1);
		const undeclared = emitted
			.flatMap((file) => importsIn(readFileSync(file, "utf8")))
			.filter((name) => !declared.has(name));
		// A consumer installs what the emitted code imports, so an undeclared one is a broken install
		// they discover at build time with no hint of where it came from.
		expect([...new Set(undeclared)]).toEqual([]);
	});

	/**
	 * **The SDK is a PEER, never a dependency, and this is not a preference.**
	 *
	 * The consumer constructs the `McpServer` and passes it to `registerTools`. Two copies of the SDK
	 * in one dependency graph make their `McpServer` a structurally identical but nominally different
	 * type from the one the generated signature names -- a `TS2345` the consumer cannot fix from
	 * their own code.
	 */
	it("declares the MCP SDK as a peer and not as a dependency", () => {
		expect(Object.keys(manifest.peerDependencies ?? {})).toContain("@modelcontextprotocol/server");
		expect(Object.keys(manifest.dependencies ?? {})).not.toContain("@modelcontextprotocol/server");
	});

	it("depends on the library by a real semver range, never by path", () => {
		const maps = [manifest.dependencies ?? {}, manifest.peerDependencies ?? {}];
		for (const map of maps) {
			for (const [name, range] of Object.entries(map)) {
				expect(`${name}: ${range}`).not.toMatch(/\b(?:file|link|portal):/);
			}
		}
		expect(manifest.dependencies?.["typespec-http-zod"]).toMatch(/^\^\d+\.\d+\.\d+$/);
	});
});

describe("the package is configured to publish the way it claims", () => {
	it("declares public access and provenance", () => {
		expect(manifest.publishConfig?.access).toBe("public");
		expect(manifest.publishConfig?.provenance).toBe(true);
		expect(manifest.license).toBe("MIT");
		expect(manifest.repository).toBeDefined();
	});

	it("ships every path its own entry points resolve to", () => {
		for (const entry of Object.values(manifest.exports)) {
			for (const [condition, target] of Object.entries(entry)) {
				if (condition === "typespec") {
					expect(existsSync(join(packageRoot, target))).toBe(true);
					continue;
				}
				// `dist/` is built, so the source it is built from is what must exist here.
				const source = target.replace(/^\.\/dist\//, "./").replace(/\.d\.ts$|\.js$/, ".ts");
				expect(existsSync(join(packageRoot, source))).toBe(true);
			}
		}
	});

	it("carries a licence and a readme, and ships no test material", () => {
		expect(existsSync(join(packageRoot, "LICENSE"))).toBe(true);
		expect(existsSync(join(packageRoot, "README.md"))).toBe(true);
		expect(manifest.files).toContain("!dist/test/**");
	});

	/**
	 * Nothing this emitter writes imports it, so a consumer needs it only at build time. Saying so in
	 * the README is what stops it becoming a runtime dependency of every service built on it.
	 */
	it("tells adopters to install it as a devDependency, and that is true of what it emits", () => {
		expect(readFileSync(join(packageRoot, "README.md"), "utf8")).toContain("devDependency");
		const selfImports = emitted
			.flatMap((file) => importsIn(readFileSync(file, "utf8")))
			.filter((name) => name === "typespec-http-mcp" || name === "typespec-http-zod");
		expect(selfImports).toEqual([]);
	});
});
