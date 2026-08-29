import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { $lib, EmitterOptionsSchema } from "../src/lib.js";

/**
 * **That the documentation and the code say the same thing, graded in BOTH directions.**
 *
 * One direction alone rots differently: documenting everything that exists still permits a paragraph
 * describing an option that was removed, and having a paragraph per option still permits an option
 * nobody documented. A hand-kept list of "what to document" rots the same way a hand-kept list of
 * anything does, so both directions are computed from `$lib`.
 */

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const reference = readFileSync(join(packageRoot, "docs", "reference.md"), "utf8");
const readme = readFileSync(join(packageRoot, "README.md"), "utf8");
const changelog = readFileSync(join(packageRoot, "CHANGELOG.md"), "utf8");
const oracles = readFileSync(join(packageRoot, "docs", "oracles.md"), "utf8");

const schema = EmitterOptionsSchema as unknown as {
	properties: Record<string, unknown> & {
		services: { additionalProperties: { properties: Record<string, unknown> } };
	};
};

describe("the reference documents every option", () => {
	const options = Object.keys(schema.properties);
	const perService = Object.keys(schema.properties.services.additionalProperties.properties);

	it("has options to check at all", () => {
		expect(options.length).toBeGreaterThanOrEqual(11);
		expect(perService.length).toBeGreaterThanOrEqual(12);
	});

	it("names every top-level option", () => {
		const undocumented = options.filter((name) => !reference.includes(`\`${name}\``));
		expect(undocumented).toEqual([]);
	});

	it("names every option this emitter ADDS per service", () => {
		// The library's own per-service keys are documented in the library. The ones added here are
		// this package's to explain, and `emit-tools` is documented under its qualified name.
		const added = ["tool-tags", "exclude-tags", "tool-prefix"];
		for (const name of added) expect(reference).toContain(`\`${name}\``);
		expect(reference).toContain("`services.<name>.emit-tools`");
	});

	it("describes no option that does not exist", () => {
		// Every fenced option name in the table must be one the schema actually accepts.
		const documented = [...reference.matchAll(/^\|\s*`([a-z-]+(?:\.<name>\.[a-z-]+)?)`\s*\|/gm)]
			.map((match) => match[1] ?? "")
			.map((name) => name.replace("services.<name>.", ""));
		expect(documented.length).toBeGreaterThanOrEqual(11);
		const unknown = documented.filter(
			(name) => !(name in schema.properties) && !perService.includes(name),
		);
		expect(unknown).toEqual([]);
	});
});

describe("the reference documents every diagnostic", () => {
	const codes = Object.keys($lib.diagnostics);

	it("has diagnostics to check at all", () => {
		expect(codes.length).toBeGreaterThanOrEqual(3);
	});

	it("gives every diagnostic a section of its own", () => {
		const undocumented = codes.filter((code) => !reference.includes(`### \`${code}\``));
		expect(undocumented).toEqual([]);
	});

	it("documents no diagnostic that does not exist", () => {
		// Scoped to the Diagnostics section: `### \`runtime-module\`` above it is an OPTION heading,
		// and a scan of the whole file would report it as a diagnostic that does not exist.
		const section = reference.slice(reference.indexOf("## Diagnostics"));
		const documented = [...section.matchAll(/^### `([a-z-]+)`$/gm)].map((m) => m[1] ?? "");
		expect(documented.length).toBeGreaterThanOrEqual(3);
		expect(documented.filter((code) => !codes.includes(code))).toEqual([]);
	});

	/**
	 * **A diagnostic nothing can raise is a promise the package cannot keep.**
	 *
	 * Declared and never reported, it documents a refusal that never happens -- so a consumer reads
	 * that the emitter will tell them, and it will not. Checked by call site rather than by trust.
	 */
	it("declares no diagnostic that has no call site", () => {
		/**
		 * **`lib.ts` is excluded, and that exclusion is what makes this arm mean anything.** Every code
		 * appears there by definition -- it is where they are declared -- so scanning it would make the
		 * check pass for a diagnostic nothing can ever raise.
		 *
		 * The match is on the quoted code rather than on `code: "..."` literally, because a refusal
		 * that dispatches through a typed union (`{ kind: "binary-tool-input" }`) is a legitimate call
		 * site whose code is still a literal a reader and a grep can both see.
		 */
		const sources = readdirSync(join(packageRoot, "src"))
			.filter((name) => name.endsWith(".ts") && name !== "lib.ts")
			.map((name) => readFileSync(join(packageRoot, "src", name), "utf8"))
			.join("\n");
		const unreachable = codes.filter((code) => !sources.includes(`"${code}"`));
		expect(unreachable).toEqual([]);
		// Non-vacuity: an empty source set would report nothing unreachable.
		expect(sources.length).toBeGreaterThanOrEqual(2000);
	});

	it("states that every refusal is a warning, and why", () => {
		expect(reference).toContain("never errors");
		expect(reference).toContain("hasError");
	});
});

describe("the documentation set holds together", () => {
	it("the README links to every document it names", () => {
		for (const doc of [
			"docs/reference.md",
			"docs/oracles.md",
			"docs/guides.md",
			"docs/releasing.md",
			"docs/measurements.md",
		]) {
			expect(readme).toContain(doc);
		}
	});

	it("every document the README links to exists", () => {
		const linked = [...readme.matchAll(/\]\((docs\/[^)]+)\)/g)].map((m) => m[1] ?? "");
		expect(linked.length).toBeGreaterThanOrEqual(5);
		const missing = linked.filter((doc) => !existsSync(join(packageRoot, doc)));
		expect(missing).toEqual([]);
	});

	it("the changelog names the version the package publishes", () => {
		const version = (
			JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
				version: string;
			}
		).version;
		expect(changelog).toContain(`## ${version}`);
	});

	/**
	 * **The governing rule of `docs/oracles.md`, made mechanical.**
	 *
	 * Every suite this package has must appear as a row, so a suite added without one is a comparison
	 * nobody wrote down. The reverse -- a row naming a suite that does not exist -- is the same rot in
	 * the other direction.
	 */
	it("names every test suite as a row, and names no suite that is gone", () => {
		const suites: string[] = [];
		const walk = (dir: string): void => {
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				if (entry.name.startsWith(".out")) continue;
				const full = join(dir, entry.name);
				if (entry.isDirectory()) walk(full);
				else if (entry.name.endsWith(".test.ts")) {
					suites.push(relative(packageRoot, full).replaceAll("\\", "/"));
				}
			}
		};
		walk(join(packageRoot, "test"));

		expect(suites.length).toBeGreaterThanOrEqual(6);
		expect(suites.filter((suite) => !oracles.includes(suite))).toEqual([]);

		const named = [...oracles.matchAll(/`(test\/[^`]+\.test\.ts)`/g)].map((m) => m[1] ?? "");
		expect([...new Set(named)].filter((suite) => !suites.includes(suite))).toEqual([]);
	});
});
