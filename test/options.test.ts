import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EmitterOptionsSchema as httpZodOptions } from "typespec-http-zod";
import { EmitterOptionsSchema } from "../src/lib.js";
import { compileFixture, type CompiledFixture } from "./support/compile-fixture.js";

/**
 * That every option `typespec-http-zod` accepts also reaches this emitter.
 *
 * **Graded as a CLASS, never as a list.** This emitter runs the whole library and adds files beside
 * its output, so an option the library gains has to arrive here. A hand-written list of expected
 * keys would pass forever while the library grew.
 *
 * This suite is also the named guard for the assertion in `src/lib.ts`: the schema is spread and then
 * asserted to its type, because the spread carries `dependencies`-family members typed over the
 * library's key set. A type error can no longer catch a spread that stopped forwarding. This can.
 */

type SchemaLike = {
	type: string;
	required: readonly string[];
	additionalProperties: boolean;
	properties: Record<string, unknown>;
};

const ours = EmitterOptionsSchema as unknown as SchemaLike;
const theirs = httpZodOptions as unknown as SchemaLike;

const serviceProperties = (schema: SchemaLike): Record<string, unknown> => {
	const services = schema.properties["services"] as {
		additionalProperties: { properties: Record<string, unknown> };
	};
	return services.additionalProperties.properties;
};

/**
 * What this emitter adds on top, stated once so the arms below can subtract it. `runtime-module` is
 * here only to be refused, see below.
 */
const ADDED_TOP_LEVEL = ["tool-tags", "exclude-tags", "tool-prefix", "runtime-module"] as const;
const ADDED_PER_SERVICE = [
	"tool-tags",
	"exclude-tags",
	"tool-prefix",
	"emit-tools",
	"runtime-module",
] as const;

describe("the options schema forwards the library's", () => {
	it("carries every top-level option the library publishes", () => {
		const missing = Object.keys(theirs.properties).filter((key) => !(key in ours.properties));
		expect(missing).toEqual([]);
		// Non-vacuity: an empty library schema would satisfy the line above.
		expect(Object.keys(theirs.properties).length).toBeGreaterThanOrEqual(7);
	});

	it("carries every per-service option the library publishes", () => {
		const theirService = serviceProperties(theirs);
		const ourService = serviceProperties(ours);
		const missing = Object.keys(theirService).filter((key) => !(key in ourService));
		expect(missing).toEqual([]);
		expect(Object.keys(theirService).length).toBeGreaterThanOrEqual(1);
	});

	it("adds only what it declares, at both levels", () => {
		const extraTop = Object.keys(ours.properties).filter((key) => !(key in theirs.properties));
		expect(extraTop.toSorted()).toEqual([...ADDED_TOP_LEVEL].toSorted());

		const theirService = serviceProperties(theirs);
		const extraService = Object.keys(serviceProperties(ours)).filter(
			(key) => !(key in theirService),
		);
		expect(extraService.toSorted()).toEqual([...ADDED_PER_SERVICE].toSorted());
	});

	it("keeps the shape the compiler validates against", () => {
		expect(ours.type).toBe("object");
		expect(ours.additionalProperties).toBe(false);
		expect(serviceProperties(ours)).toBeTypeOf("object");
	});
});

/**
 * **`runtime-module` is refused, loudly, and the emitted runtime is used anyway.**
 *
 * The option let an application replace the runtime, which made it own a copy of generated logic.
 * It stays in the schema so an application upgrading from a version that documented it gets
 * `runtime-module-removed`, which says what to do, rather than "must NOT have additional properties",
 * which does not. Refused at both places it could be set, exactly as the sibling server emitter
 * refuses its own.
 */
describe("runtime-module is refused", () => {
	const reference = join(fileURLToPath(new URL(".", import.meta.url)), "reference");

	/** What a refused `runtime-module` must leave behind, wherever it was set. */
	function expectRefused(compiled: CompiledFixture): void {
		expect(compiled.diagnostics).toContainEqual({
			code: "typespec-http-mcp/runtime-module-removed",
			severity: "error",
		});
		// Ignored, not honoured: the generated tools still import the runtime this package emits.
		expect(existsSync(join(compiled.outDir, "mcp-runtime.gen.ts"))).toBe(true);
		const tools = readFileSync(join(compiled.outDir, "mcp.gen.ts"), "utf8");
		expect(tools).toContain('from "./mcp-runtime.gen.js"');
		expect(tools).not.toContain("my-runtime");
		expect(readFileSync(join(compiled.outDir, "schemas.gen.ts"), "utf8")).not.toContain(
			"my-runtime",
		);
	}

	it("at the top level", async () => {
		expectRefused(
			await compileFixture(reference, "service", {
				outName: "options-runtime-module-top",
				extraOptions: { "runtime-module": "../my-runtime.js" },
			}),
		);
	}, 300_000);

	it("per service", async () => {
		expectRefused(
			await compileFixture(reference, "service", {
				outName: "options-runtime-module-service",
				extraOptions: { services: { Widgets: { "runtime-module": "../my-runtime.js" } } },
			}),
		);
	}, 300_000);

	it("and not when it is unset", async () => {
		const compiled = await compileFixture(reference, "service", {
			outName: "options-runtime-module-unset",
		});
		expect(compiled.diagnostics.map((d) => d.code)).not.toContain(
			"typespec-http-mcp/runtime-module-removed",
		);
		expect(existsSync(join(compiled.outDir, "mcp.gen.ts"))).toBe(true);
	}, 300_000);
});
