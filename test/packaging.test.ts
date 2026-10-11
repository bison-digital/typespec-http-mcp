import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { workingTreeFiles } from "./support/working-tree.js";
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
	const sources = workingTreeFiles(packageRoot, "src").filter((name) => name.endsWith(".ts"));

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

	/**
	 * **The resolved `typespec-http-zod` has to carry the API `src/` compiles against, and a version
	 * range cannot say so on its own.**
	 *
	 * Features land in the library before the emitters that read them, and every version this range
	 * admits but the newest may lack them. A checkout resolving such a version fails `tsc` with errors
	 * about `RouteSchemaNames` that name nothing a reader could act on; `main` once built only because
	 * `node_modules` held hand-made links to the sibling checkout, which nothing in the repository
	 * recorded. This arm says it in one sentence: release the library first, and raise this floor.
	 *
	 * **Compiled, not matched.** Every name `src/` imports from the library is read off the import
	 * statements themselves, and the members below are the newest ones `src/` reads, each with its
	 * reader. A probe naming all of them is compiled against whatever resolved.
	 */
	it("resolves a typespec-http-zod that carries the API src/ compiles against", () => {
		const imported = new Set<string>();
		for (const name of sources) {
			const text = readFileSync(join(packageRoot, name), "utf8");
			for (const clause of text.matchAll(
				/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"typespec-http-zod"/g,
			)) {
				for (const part of (clause[1] ?? "").split(",")) {
					const symbol = part
						.trim()
						.replace(/^type\s+/, "")
						.split(/\s+as\s+/)[0];
					if (symbol !== undefined && symbol !== "") imported.add(symbol);
				}
			}
		}
		// Non-vacuity: a pattern that stopped matching would compile an empty probe.
		expect(imported.size).toBeGreaterThanOrEqual(10);
		expect(imported).toContain("resultMembersOf");

		const members = [
			// tools.ts, the accept a negotiated tool supplies
			'RouteSchemaNames["selectedAccept"]',
			// tools.ts, the cookie group merged into arguments
			'RouteSchemaNames["cookie"]',
			// tools.ts, a gathered query's object
			'RouteSchemaNames["queryFields"]',
			// refusals.ts, a raw body refused as binary
			'EmittedRoute["rawBodyBinary"]',
			// emitter.ts and select.ts, the operation a route came from
			'EmittedService["operations"]',
		];
		const probeDir = join(packageRoot, "test", ".out-packaging-api");
		mkdirSync(probeDir, { recursive: true });
		const symbols = [...imported].toSorted();
		writeFileSync(
			join(probeDir, "probe.ts"),
			`import type { ${symbols.join(", ")} } from "typespec-http-zod";

export type Members = [${members.join(", ")}];
`,
		);
		const config = join(probeDir, "tsconfig.json");
		writeFileSync(
			config,
			JSON.stringify({
				compilerOptions: {
					target: "es2023",
					module: "nodenext",
					moduleResolution: "nodenext",
					strict: true,
					noEmit: true,
					skipLibCheck: true,
					types: [],
				},
				include: ["./probe.ts"],
			}),
		);
		let output = "";
		try {
			execFileSync(
				join(packageRoot, "node_modules", ".bin", "tsc"),
				["-p", config, "--ignoreConfig"],
				{
					encoding: "utf8",
					stdio: ["ignore", "pipe", "pipe"],
				},
			);
		} catch (error) {
			const asExec = error as { stdout?: string; stderr?: string };
			output = `${asExec.stdout ?? ""}${asExec.stderr ?? ""}`.trim();
		}
		const range = manifest.dependencies?.["typespec-http-zod"];
		expect(
			output,
			`the resolved typespec-http-zod lacks API src/ uses; the declared range is ${range}. Release typespec-http-zod first and raise this floor.`,
		).toBe("");
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

/**
 * **A workflow that does not exist cannot refuse anything.**
 *
 * These were listed as done once while the directory was empty, and nothing said so. The release
 * guard in particular is load-bearing: `--frozen-lockfile` exits 0 on a dangling link, so a release
 * checkout with a `link:` override and no sibling on disk installs happily and fails four steps
 * later as a wall of TS2307 that names the module but not the cause.
 */
describe("the workflows that gate a release exist and can refuse", () => {
	const workflows = join(packageRoot, ".github", "workflows");

	it("has both a CI and a release workflow", () => {
		expect(existsSync(join(workflows, "ci.yml"))).toBe(true);
		expect(existsSync(join(workflows, "release.yml"))).toBe(true);
	});

	it("the release workflow refuses a locally-linked first-party dependency", () => {
		const release = readFileSync(join(workflows, "release.yml"), "utf8");
		expect(release).toContain("Refuse to publish against a locally-linked dependency");
		expect(release).toMatch(/link\|file/);
		expect(release).toContain("exit 1");
	});

	it("the release workflow proves every peer the emitted runtime needs actually resolved", () => {
		const release = readFileSync(join(workflows, "release.yml"), "utf8");
		for (const dependency of ["typespec-http-zod", "@modelcontextprotocol/server"]) {
			expect(release).toContain(`await import('${dependency}')`);
		}
	});

	it("CI runs every gate this package claims, by name", () => {
		const ci = readFileSync(join(workflows, "ci.yml"), "utf8");
		for (const gate of ["build", "test", "typecheck", "lint", "format:check"]) {
			expect(ci, gate).toContain(gate);
		}
	});
});
