import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compile, NodeHost } from "@typespec/compiler";
import { beforeAll, describe, expect, it } from "vitest";
import { corpusScenarios, packageRoot } from "./scenarios.js";

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

/**
 * Scenarios where THIS emitter refuses every operation, so the surface is empty, with the refusal.
 *
 * **A scenario can go to zero tools without failing anything, and two already have.** The floor
 * below is corpus-wide, so a surface that collapsed would be absorbed by the other 63; the emit arm
 * only asks whether a file was written, and a file is written either way. Named rather than
 * tolerated, so a third one is a change somebody explains.
 *
 * All are correct. A multipart body cannot be a tool argument, and every operation in the two
 * streaming scenarios answers with a stream, while a tool result is one message.
 *
 * **`versioning/returnTypeChangedFrom` left this list rather than being tolerated in it.** Its
 * `@body body: string` was refused as `non-object-body` because the library MERGED a body that is not
 * a model into the parameters; the library now names such a body, so it arrives as an ordinary `body`
 * argument and the scenario emits its tools. The refusal still stands for a body this emitter cannot
 * carry, which `test/refusals` states directly.
 */
const EMITTER_REFUSES_EVERY_OPERATION: Readonly<Record<string, string>> = {
	payload__multipart: "typespec-http-mcp/binary-tool-input",
	streaming__jsonl: "typespec-http-mcp/streamed-tool-output",
	streaming__sse: "typespec-http-mcp/streamed-tool-output",
};

interface Scenario {
	readonly name: string;
	readonly dir: string;
	readonly diagnostics: readonly { code: string; severity: string }[];
}

let scenarios: Scenario[] = [];

beforeAll(async () => {
	rmSync(outputRoot, { recursive: true, force: true });
	const collected: Scenario[] = [];
	for (const { name, main } of corpusScenarios()) {
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

	/**
	 * **Every scenario whose surface is empty is named here, with the refusal that emptied it.**
	 *
	 * Asserted in BOTH directions: a scenario that stops emitting tools must be listed, and one that
	 * starts emitting them again must be removed. Counting would let a new collapse hide behind a
	 * scenario that recovered.
	 */
	it("empties exactly the scenarios named, under the refusals named", () => {
		const empty = scenarios
			.filter((scenario) => {
				const file = join(scenario.dir, "mcp.gen.ts");
				return existsSync(file) && /TOOL_NAMES = \[\] as const/.test(readFileSync(file, "utf8"));
			})
			.map((scenario) => scenario.name);
		expect(empty.toSorted()).toEqual(Object.keys(EMITTER_REFUSES_EVERY_OPERATION).toSorted());

		for (const [name, code] of Object.entries(EMITTER_REFUSES_EVERY_OPERATION)) {
			const scenario = scenarios.find((s) => s.name === name);
			expect(
				scenario?.diagnostics.map((d) => d.code),
				name,
			).toContain(code);
		}
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

/**
 * **What a VERSIONED spec emits, as opposed to whether it compiles.**
 *
 * Seven corpus scenarios are versioned and every one of them compiles, which was the whole of what
 * this suite said about them. Compiling proves the file parses; it says nothing about WHICH version
 * of a changing surface the file describes, and that is the only interesting question a versioned
 * spec asks. An emitter that emitted the union of every version -- a tool for an operation the
 * served version has removed -- would compile perfectly.
 *
 * The answer, measured rather than assumed: **the emitter emits the LATEST version's surface**,
 * because that is the projection `typespec-http-zod` hands it. These arms pin that.
 */
function toolNamesOf(scenario: Scenario): string[] {
	const source = readFileSync(join(scenario.dir, "mcp.gen.ts"), "utf8");
	const match = /TOOL_NAMES = \[([^\]]*)\]/.exec(source);
	return [...(match?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "").toSorted();
}

const scenarioNamed = (name: string): Scenario => {
	const found = scenarios.find((scenario) => scenario.name === name);
	if (found === undefined) throw new Error(`the corpus no longer declares ${name}`);
	return found;
};

describe("a versioned spec emits the latest version's surface, not the union of all of them", () => {
	/**
	 * `op v1` and `interface InterfaceV1` are both `@removed(Versions.v2)`. An emitter working from
	 * the union would still name them; one working from the latest projection does not.
	 */
	it("drops what the latest version removed", () => {
		const tools = toolNamesOf(scenarioNamed("versioning__removed"));
		expect(tools).toEqual(["modelV3", "v2"]);
		expect(tools).not.toContain("v1");
		expect(tools.some((name) => name.startsWith("InterfaceV1"))).toBe(false);
	});

	/**
	 * **A parameter removed at the served version must not survive as a tool argument.**
	 *
	 * `op v2` declares `@removed(Versions.v2) @query param: string`. A tool that still advertised
	 * `param` would invite a client to send something the service rejects -- and unlike a missing
	 * tool, nothing about it fails to compile.
	 */
	it("drops a parameter the latest version removed from the tool's input", () => {
		const source = readFileSync(
			join(scenarioNamed("versioning__removed").dir, "mcp.gen.ts"),
			"utf8",
		);
		const input = /const v2Input = ([^;]+);/.exec(source)?.[1] ?? "";
		// Non-vacuity: a regex that matched nothing would contain no "param" either.
		expect(input).not.toBe("");
		expect(input).not.toContain("param");
	});

	it("keeps what the latest version added", () => {
		expect(toolNamesOf(scenarioNamed("versioning__added"))).toEqual([
			"InterfaceV2_v2InInterface",
			"v1",
			"v2",
		]);
	});

	/** The NEW name, never the old one, or a client would call something that is not there. */
	it("names a renamed operation by its current name", () => {
		const tools = toolNamesOf(scenarioNamed("versioning__renamedFrom"));
		expect(tools).toEqual(["NewInterface_newOpInNewInterface", "newOp"]);
		expect(tools.some((name) => name.toLowerCase().includes("old"))).toBe(false);
	});

	/** A versioned SERVER is a different axis from a versioned type, and it must not lose tools. */
	it("emits every operation of a versioned server", () => {
		expect(toolNamesOf(scenarioNamed("server__versions__versioned"))).toEqual([
			"withPathApiVersion",
			"withQueryApiVersion",
			"withQueryOldApiVersion",
			"withoutApiVersion",
		]);
	});
});
