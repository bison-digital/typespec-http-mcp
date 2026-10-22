import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, NodeHost } from "@typespec/compiler";
import { describe, expect, it } from "vitest";

/**
 * **Two emitters, one directory: silent when the options match, loud when they do not.**
 *
 * The hazard is real and unguarded in the published packages: `emitFile` has no duplicate-path
 * detection, so both emitters write `schemas.gen.ts` and the order of `emit:` decides the winner.
 * With nothing configured it cannot happen -- each emitter defaults to a directory named after
 * itself -- so the diagnostic is about a deliberate arrangement, and only about the bad half of it.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const spec = join(here, "..", "agreement", "service.tsp");
const CODE = "typespec-http-mcp/shared-output-dir";

async function compileWith(
	outName: string,
	options: Record<string, Record<string, unknown>>,
	emit: string[],
	outputDir?: string,
): Promise<string[]> {
	const out = join(here, ".out", outName);
	rmSync(out, { recursive: true, force: true });
	const program = await compile(NodeHost, spec, {
		outputDir: outputDir ?? out,
		emit,
		options,
	});
	return program.diagnostics.map((d) => d.code);
}

describe("sharing one output directory", () => {
	it("is SILENT when both emitters resolve the same library options", async () => {
		const out = join(here, ".out", "matching");
		const shared = { "emitter-output-dir": out };
		const codes = await compileWith(
			"matching",
			{
				"typespec-hono": shared,
				"typespec-http-mcp": shared,
			},
			["typespec-hono", "typespec-http-mcp"],
			out,
		);
		expect(codes).not.toContain(CODE);
		// Non-vacuity: a compile that failed outright would also not contain the code.
		expect(codes.filter((code) => code.includes("error"))).toEqual([]);
	}, 300_000);

	it("WARNS when a library option differs, naming the emitter and the option", async () => {
		const out = join(here, ".out", "divergent");
		const codes = await compileWith(
			"divergent",
			{
				"typespec-hono": {
					"emitter-output-dir": out,
					"seal-object-schemas": true,
				},
				"typespec-http-mcp": {
					"emitter-output-dir": out,
					"seal-object-schemas": false,
				},
			},
			["typespec-hono", "typespec-http-mcp"],
			out,
		);
		expect(codes).toContain(CODE);
	}, 300_000);

	it("WARNS when one emitter sets an option the other leaves unset", async () => {
		const out = join(here, ".out", "asymmetric");
		const codes = await compileWith(
			"asymmetric",
			{
				"typespec-hono": { "emitter-output-dir": out },
				"typespec-http-mcp": {
					"emitter-output-dir": out,
					"compile-schemas": false,
				},
			},
			["typespec-hono", "typespec-http-mcp"],
			out,
		);
		expect(codes).toContain(CODE);
	}, 300_000);
});

describe("the arrangements that are not a hazard", () => {
	it("is SILENT when each emitter writes to its own directory", async () => {
		const out = join(here, ".out", "separate");
		rmSync(out, { recursive: true, force: true });
		const codes = await compileWith(
			"separate",
			{
				"typespec-hono": {
					"emitter-output-dir": join(out, "hono"),
					"seal-object-schemas": true,
				},
				"typespec-http-mcp": {
					"emitter-output-dir": join(out, "mcp"),
					"seal-object-schemas": false,
				},
			},
			["typespec-hono", "typespec-http-mcp"],
			out,
		);
		// Options differ wildly, but nothing is contested, so there is nothing to say.
		expect(codes).not.toContain(CODE);
	}, 300_000);

	it("is SILENT when this emitter runs alone", async () => {
		const out = join(here, ".out", "alone");
		const codes = await compileWith(
			"alone",
			{
				"typespec-http-mcp": { "emitter-output-dir": out },
			},
			["typespec-http-mcp"],
			out,
		);
		expect(codes).not.toContain(CODE);
	}, 300_000);
});
