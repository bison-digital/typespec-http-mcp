import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, NodeHost } from "@typespec/compiler";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * **Every scenario `@typespec/http-specs` declares, emitted and COMPILED.**
 *
 * This package was built against three hand-written fixtures. They pass, and they were never going
 * to be enough: the first run of this suite compiled 65 scenarios and **41 of the emitted files did
 * not typecheck** -- four distinct defects, one of which produced a `TS2345` in a file a consumer
 * cannot edit.
 *
 * "Emitted" is not the assertion. A corpus written and never compiled is the vacuity trap this
 * estate has already recorded once, and it is the one that hid all four.
 */

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const specs = join(packageRoot, "node_modules", "@typespec", "http-specs", "specs");
const outputRoot = join(packageRoot, "test", ".out-corpus");

/**
 * Scenarios the LIBRARY refuses, with the diagnostic it refuses them under.
 *
 * Named rather than counted: a scenario that starts failing for a different reason must not be
 * absorbed by a tolerance. Neither is this emitter's doing.
 */
const LIBRARY_REFUSES: Readonly<Record<string, string>> = {
	"response__status-code-range": "typespec-http-zod/unsupported-status-code-range",
	type__union__discriminated: "typespec-http-zod/undeclared-discriminator",
};

interface Scenario {
	readonly name: string;
	readonly dir: string;
	readonly diagnostics: readonly { code: string; severity: string }[];
}

let scenarios: Scenario[] = [];

function mainsUnder(dir: string, found: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) mainsUnder(full, found);
		else if (entry.name === "main.tsp") found.push(full);
	}
	return found;
}

beforeAll(async () => {
	rmSync(outputRoot, { recursive: true, force: true });
	const collected: Scenario[] = [];
	for (const main of mainsUnder(specs)) {
		const name = main
			.slice(specs.length + 1)
			.replace(/\/main\.tsp$/, "")
			.replaceAll("/", "__");
		const dir = join(outputRoot, name);
		const program = await compile(NodeHost, main, {
			outputDir: dir,
			emit: ["typespec-http-mcp"],
			options: { "typespec-http-mcp": { "emitter-output-dir": dir } },
		});
		collected.push({
			name,
			dir,
			diagnostics: program.diagnostics.map((d) => ({ code: d.code, severity: d.severity })),
		});
	}
	scenarios = collected;
}, 1_800_000);

/** `tsc` over one emitted directory, under the settings a consumer builds with. */
function typecheck(dir: string): string {
	const config = join(dir, "tsconfig.emitted.json");
	writeFileSync(
		config,
		JSON.stringify({
			compilerOptions: {
				target: "es2023",
				module: "nodenext",
				moduleResolution: "nodenext",
				strict: true,
				exactOptionalPropertyTypes: true,
				noUncheckedIndexedAccess: true,
				noUnusedLocals: true,
				noUnusedParameters: true,
				noEmit: true,
				skipLibCheck: true,
				types: [],
			},
			include: ["./*.ts"],
		}),
	);
	try {
		execFileSync(
			join(packageRoot, "node_modules", ".bin", "tsc"),
			["-p", config, "--ignoreConfig"],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		);
		return "";
	} catch (error) {
		const asExec = error as { stdout?: string; stderr?: string };
		return `${asExec.stdout ?? ""}${asExec.stderr ?? ""}`;
	}
}

describe("the corpus is large enough to be evidence", () => {
	it("compiled every scenario the corpus declares", () => {
		expect(scenarios.length).toBeGreaterThanOrEqual(60);
	});

	/**
	 * **Every scenario emits, including the two the library reports an error for.** TypeSpec runs
	 * emitters whatever the diagnostics say, so a file is written either way -- which is why the
	 * compile arm below, not the emit count, is what proves anything.
	 */
	it("emits a tool surface for every scenario", () => {
		const emitted = scenarios.filter((s) => existsSync(join(s.dir, "mcp.gen.ts")));
		expect(emitted.length).toBe(scenarios.length);
	});

	it("refuses exactly the scenarios named, under the diagnostics named", () => {
		for (const [name, code] of Object.entries(LIBRARY_REFUSES)) {
			const scenario = scenarios.find((s) => s.name === name);
			expect(
				scenario?.diagnostics.map((d) => d.code),
				name,
			).toContain(code);
		}
		// And nothing else fails to compile, which is what stops the list above absorbing a regression.
		const failing = scenarios
			.filter((s) => s.diagnostics.some((d) => d.severity === "error"))
			.map((s) => s.name);
		expect(failing.toSorted()).toEqual(Object.keys(LIBRARY_REFUSES).toSorted());
	});

	it("produces a tool surface worth grading", () => {
		let tools = 0;
		for (const scenario of scenarios) {
			const file = join(scenario.dir, "mcp.gen.ts");
			if (!existsSync(file)) continue;
			const match = /TOOL_NAMES = \[([^\]]*)\]/.exec(readFileSync(file, "utf8"));
			tools += [...(match?.[1] ?? "").matchAll(/"[^"]+"/g)].length;
		}
		// Measured at 703. A floor well under it still catches a surface that collapsed.
		expect(tools).toBeGreaterThanOrEqual(500);
	});
});

describe("every emitted file compiles", () => {
	/**
	 * **Every scenario, with no exceptions list.** There was one: `special-words` declares models named
	 * `as` and `yield`, and the library emitted `export type as = ...` and `export type yield = ...`,
	 * neither of which parses. It was pinned by name, and the pin failed the day the defect closed --
	 * which is how it came to be closed rather than inherited.
	 *
	 * **The list is gone rather than empty.** A skip list with no entries is a loop that cannot run and
	 * an arm that cannot fail, which is the shape this suite exists to refuse. Reintroducing a pin
	 * means reintroducing the arm that asserts the pinned scenario is still broken.
	 */
	it("typechecks under strict, exactOptionalPropertyTypes, noUnusedLocals and types: []", () => {
		const failures: string[] = [];
		let compiled = 0;
		for (const scenario of scenarios) {
			if (!existsSync(join(scenario.dir, "mcp.gen.ts"))) continue;
			compiled += 1;
			const output = typecheck(scenario.dir);
			if (output !== "") {
				const first = output.split("\n").find((line) => line.includes("error TS")) ?? output;
				failures.push(`${scenario.name}: ${first.replace(scenario.dir + "/", "").trim()}`);
			}
		}
		expect(failures).toEqual([]);
		// Non-vacuity: a run that typechecked nothing would report no failures either.
		expect(compiled).toBe(scenarios.length);
		expect(compiled).toBeGreaterThanOrEqual(60);
	}, 1_800_000);
});
