import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileBothSurfaces } from "./support.js";

/**
 * **The arm that either validates "adapter, not proxy" or sends the design back.**
 *
 * One handler object, two generated surfaces, compiled together. The two emitters live in separate
 * packages and each derives a handler signature from the same `typespec-http-zod` artefacts by the
 * same rules. Nothing but a compile can tell whether they still agree.
 *
 * The estate's hardest-won lesson is that fixing a library did not fix the boundary a consumer types
 * against, and the fix was to compile a hand-written consumer against emitted output. The boundary
 * here is a composition root that hands one object to both `registerRoutes` and `registerTools`.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

let outDir = "";
let diagnostics: readonly { code: string; severity: string }[] = [];

beforeAll(async () => {
	const compiled = await compileBothSurfaces("agreement");
	outDir = compiled.outDir;
	diagnostics = compiled.diagnostics;
}, 900_000);

const COMPILER_OPTIONS = {
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
} as const;

/** Run `tsc` over one config, returning what it printed and whether it failed. */
function tsc(config: string): { output: string; failed: boolean } {
	try {
		const output = execFileSync(
			join(packageRoot, "node_modules", ".bin", "tsc"),
			["-p", config, "--ignoreConfig"],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		);
		return { output, failed: false };
	} catch (error) {
		const asExec = error as { stdout?: string; stderr?: string };
		return { output: `${asExec.stdout ?? ""}${asExec.stderr ?? ""}`, failed: true };
	}
}

/** Compile the consumer fixture against freshly emitted output. Exit code is the assertion. */
function typecheckConsumer(): { output: string; failed: boolean } {
	const config = join(here, "tsconfig.agreement.json");
	writeFileSync(
		config,
		JSON.stringify(
			{ compilerOptions: COMPILER_OPTIONS, include: ["./consumer.fixture.ts"] },
			null,
			"\t",
		),
	);
	return tsc(config);
}

describe("both surfaces are generated from one spec, into one directory", () => {
	it("compiles clean, with both emitters in one program", () => {
		expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	});

	it("emits both surfaces, each one's own runtime, and one set of validators", () => {
		for (const file of [
			"app.gen.ts",
			"runtime.gen.ts",
			"mcp.gen.ts",
			"mcp-runtime.gen.ts",
			"schemas.gen.ts",
		]) {
			expect(() => readFileSync(join(outDir, file), "utf8")).not.toThrow();
		}
	});

	/**
	 * **Both emitters write `schemas.gen.ts`, and with no `runtime-module` it depends on neither
	 * runtime.** It used to import its arm type from whatever `runtime-module` named, so the two
	 * emitters had to agree on that specifier or the order of `emit:` decided which import survived. It
	 * now declares the type itself and imports nothing but Zod, so whichever emitter wrote it last, the
	 * content is the same.
	 */
	it("the shared validators import no runtime, whichever emitter wrote them", () => {
		const schemas = readFileSync(join(outDir, "schemas.gen.ts"), "utf8");
		expect(schemas.length).toBeGreaterThanOrEqual(500);
		const imports = [...schemas.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
		expect(imports).toEqual(["zod"]);
		expect(schemas).toMatch(/^type ResponseArm = \{$/m);
	});

	it("the tool surface imports the runtime it emitted", () => {
		const mcp = readFileSync(join(outDir, "mcp.gen.ts"), "utf8");
		const runtimes = [...mcp.matchAll(/^import .* from "(\.\/[^"]*runtime[^"]*)";$/gm)].map(
			(m) => m[1],
		);
		expect(runtimes.length).toBeGreaterThanOrEqual(1);
		expect(new Set(runtimes)).toEqual(new Set(["./mcp-runtime.gen.js"]));
	});
});

/**
 * Compile a copy of the consumer fixture with one thing changed, beside the real one's output.
 *
 * Returns what `tsc` said and a way to find a line in the copy, so a variant can assert WHERE it was
 * refused and not only that it was.
 */
function compileVariant(
	name: string,
	source: string,
): { output: string; failed: boolean; lineOf: (text: string) => number } {
	const dir = join(here, ".out", name);
	mkdirSync(dir, { recursive: true });
	const variant = source.replaceAll("./.out/agreement/", "../agreement/");
	writeFileSync(join(dir, "consumer.fixture.ts"), variant);
	const config = join(dir, "tsconfig.json");
	writeFileSync(
		config,
		JSON.stringify({ compilerOptions: COMPILER_OPTIONS, include: ["./consumer.fixture.ts"] }),
	);
	const lines = variant.split("\n");
	return {
		...tsc(config),
		lineOf: (text: string): number => lines.findIndex((line) => line.includes(text)) + 1,
	};
}

describe("ONE handler object satisfies both surfaces, with no cast", () => {
	it("compiles", () => {
		const { output, failed } = typecheckConsumer();
		expect(output).toBe("");
		expect(failed).toBe(false);
	}, 300_000);

	/**
	 * **The fixture must not be able to cheat.** A cast, a widening helper, or a second handler object
	 * would each make the compile above pass while proving nothing.
	 */
	it("the fixture uses no cast and no widening helper", () => {
		const source = readFileSync(join(here, "consumer.fixture.ts"), "utf8");
		for (const evasion of [
			/as unknown as/,
			/@ts-expect-error/,
			/@ts-ignore/,
			/\bas [A-Z]/,
			/\bany\b/,
		]) {
			expect(evasion.test(source), `fixture contains ${evasion}`).toBe(false);
		}
	});

	it("the fixture declares the handler object exactly once, and passes it to both", () => {
		const source = readFileSync(join(here, "consumer.fixture.ts"), "utf8");
		expect([...source.matchAll(/const operations = \{/g)]).toHaveLength(1);
		expect(source).toContain("registerRoutes(app, () => operations, routeDeps)");
		expect(source).toContain("registerTools(server, () => operations, toolDeps)");
	});

	/**
	 * **The handler object carries no type ANNOTATION**, which is what keeps both surplus-key guards
	 * alive: annotating widens the value and each guard collapses to `never`. `satisfies` is not an
	 * annotation, since it leaves the object's type as written, and the arm below measures that rather
	 * than assuming it.
	 */
	it("the handler object carries no annotation", () => {
		const source = readFileSync(join(here, "consumer.fixture.ts"), "utf8");
		expect(source).not.toMatch(/const operations: /);
		expect(source).toMatch(/^\} satisfies Operations<Caller>;$/m);
	});

	/**
	 * **Both surplus-key guards survive `satisfies`, measured on the fixture itself.**
	 *
	 * A handler for an operation the spec no longer declares is added to a copy of the fixture. It must
	 * be refused at `registerRoutes` AND at `registerTools`, not only by `satisfies`' own excess-property
	 * check: an application that dropped `satisfies` would otherwise lose the refusal without noticing.
	 */
	it("a removed operation is refused by both registration calls, not only by satisfies", () => {
		const source = readFileSync(join(here, "consumer.fixture.ts"), "utf8");
		const anchor = "\tWidgetTools_replace: (_ctx: Caller, input) => ({";
		expect(source).toContain(anchor);
		const { output, failed, lineOf } = compileVariant(
			"agreement-surplus",
			source.replace(
				anchor,
				`\tremovedFromTheSpec: (_ctx: Caller, _input: Record<string, never>) => ({ status: 200 }),\n${anchor}`,
			),
		);
		expect(failed).toBe(true);
		const routes = lineOf("registerRoutes(app, () => operations, routeDeps)");
		const tools = lineOf("registerTools(server, () => operations, toolDeps)");
		expect(routes).toBeGreaterThan(0);
		expect(tools).toBeGreaterThan(0);
		expect(output).toMatch(new RegExp(`consumer\\.fixture\\.ts\\(${routes},\\d+\\): error TS2322`));
		expect(output).toMatch(new RegExp(`consumer\\.fixture\\.ts\\(${tools},\\d+\\): error TS2322`));
		expect(output).toContain("removedFromTheSpec");
	}, 300_000);

	/**
	 * **`registerTools` refuses a handler asking for more of the caller than `deps.context` gives.**
	 *
	 * The handler's first parameter is `Caller` plus scopes; `toolDeps` establishes a `Caller`. `Tools`
	 * declares each handler as a PROPERTY, whose parameters TypeScript compares contravariantly, so this
	 * is refused at the `registerTools` call itself. Declared as a method, the comparison is bivariant
	 * and the call compiles, handing the handler a context without the scopes it reads.
	 */
	it("a handler wanting a richer caller context than deps.context is refused by registerTools", () => {
		const source = readFileSync(join(here, "consumer.fixture.ts"), "utf8");
		const anchor =
			"\thealth: (ctx: Caller, _input) => ({ status: 200, body: { status: ctx.subject } }),";
		expect(source).toContain(anchor);
		const { output, failed, lineOf } = compileVariant(
			"agreement-context",
			source.replace(
				anchor,
				"\thealth: (ctx: Caller & { readonly scopes: readonly string[] }, _input) => ({ status: 200, body: { status: ctx.scopes.join() } }),",
			),
		);
		expect(failed).toBe(true);
		const tools = lineOf("registerTools(server, () => operations, toolDeps)");
		expect(tools).toBeGreaterThan(0);
		expect(output).toMatch(new RegExp(`consumer\\.fixture\\.ts\\(${tools},\\d+\\): error TS2`));
	}, 300_000);

	it("asserts identity per operation, not just assignability", () => {
		const source = readFileSync(join(here, "consumer.fixture.ts"), "utf8");
		// Counted by declaration, not by a `MustHold<Identical<` token pair: the formatter wraps a long
		// one onto two lines, and a regex spanning them silently counted six of seven.
		const assertions = [...source.matchAll(/^type _[A-Za-z]+ = MustHold</gm)];
		// One per tool, the key set and the refusal. Assignability alone would accept a WIDER Tools input.
		expect(assertions.length).toBeGreaterThanOrEqual(12);
		// Against the caller context the deps establish, so a `C` one side ignored would not be identical.
		expect(source).not.toMatch(/\b(?:Tools|Operations)\[|keyof (?:Tools|Operations)\b(?!<)/);
		expect(source).toContain("declare const toolDeps: ToolDeps<Caller>;");
		expect(source).toContain("declare const routeDeps: RouteDeps<AppEnv, Caller>;");
	});
});

/**
 * **The one derivation this package genuinely duplicates, and the arm that stops it drifting.**
 *
 * `securityFor` reads `getAuthenticationForOperation` off the HTTP program and turns it into the
 * document's `security` requirements. The sibling server emitter does exactly the same and does not
 * export it, so this package reimplements ~30 lines. That duplication is deliberate and temporary --
 * the derivation belongs in the library both emitters run -- but until then it is ungraded unless
 * something compares the two.
 *
 * Nothing can import the sibling's copy, so the comparison is of what each one WRITES. Both render
 * the requirements as a TypeScript literal at their own call site: `deps.authorize(...)` for the HTTP
 * surface, `deps.permits(...)` for the tool surface. Equal literals mean equal derivations.
 */
describe("the duplicated security derivation still agrees with the sibling's", () => {
	/** Balanced-bracket extraction: the literal contains nested arrays, so a lazy regex stops early. */
	function literalsAfter(source: string, call: string): string[] {
		const found: string[] = [];
		let from = 0;
		for (;;) {
			const at = source.indexOf(call, from);
			if (at === -1) break;
			let depth = 0;
			let end = at + call.length;
			for (; end < source.length; end += 1) {
				const ch = source[end];
				if (ch === "[") depth += 1;
				else if (ch === "]") {
					depth -= 1;
					if (depth === 0) break;
				}
			}
			found.push(source.slice(at + call.length, end + 1));
			from = end;
		}
		return found;
	}

	it("renders the same requirements as the sibling, for every operation", () => {
		const app = readFileSync(join(outDir, "app.gen.ts"), "utf8");
		const mcp = readFileSync(join(outDir, "mcp.gen.ts"), "utf8");

		const theirs = new Set(literalsAfter(app, "deps.authorize("));
		const mine = new Set(literalsAfter(mcp, "deps.permits("));

		expect([...mine].toSorted()).toEqual([...theirs].toSorted());
	});

	/**
	 * **Non-vacuity, and it is the whole arm.** A spec declaring no authentication renders `[]` on
	 * both sides, and `[] === []` proves nothing about either derivation. The fixture declares two
	 * schemes that take different branches: a bearer scheme carries no scopes, an OAuth2 scheme
	 * carries them per flow.
	 */
	it("the fixture exercises both branches, so the comparison is not [] against []", () => {
		const mcp = readFileSync(join(outDir, "mcp.gen.ts"), "utf8");
		const literals = literalsAfter(mcp, "deps.permits(");
		expect(literals.length).toBeGreaterThanOrEqual(5);
		expect(literals.every((literal) => literal !== "[]")).toBe(true);
		// A scheme with no scopes, and a scheme with scopes, in one requirement list.
		expect(literals[0]).toContain('"BearerAuth": []');
		expect(literals[0]).toMatch(/"OAuth2Auth": \["widgets\.read", "widgets\.write"\]/);
	});
});
