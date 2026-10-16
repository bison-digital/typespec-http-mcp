import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";
import type { Generated } from "../support/mcp-client.js";

/**
 * **An operation two of whose inputs would arrive as one argument is not a tool.** See
 * `sharedkeys.tsp`.
 *
 * A tool's arguments spread the parameter groups into one object, as a server's handler input does,
 * so `@header("x")` beside `@query("x")` published one `x` whose later schema replaced the earlier
 * (typespec-http-graphql, 2026-10-16). The library names the pair; the tool surface declines it, and
 * counts it, so `emitted + refused === selected` still holds.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let generated: Generated;

const PAIRS: readonly (readonly [string, string])[] = [
	["headerQuery", "the header 'x' and the query parameter 'x'"],
	["queryQuery", "the query parameter 'x' and the query parameter 'x'"],
	["queryQueryAgreeing", "the query parameter 'y' and the query parameter 'y'"],
	["pathHeader", "the path parameter 'id' and the header 'id'"],
	["cookieQuery", "the cookie 'session' and the query parameter 'session'"],
	["queryBody", "the query parameter 'body' and the body 'body'"],
];

beforeAll(async () => {
	compiled = await compileFixture(here, "sharedkeys", { outName: "sharedkeys" });
	generated = (await import(join(compiled.outDir, "mcp.gen.ts"))) as unknown as Generated;
}, 300_000);

describe("two inputs under one key", () => {
	it("is reported by the library and refused here, once each per operation", () => {
		const codes = compiled.diagnostics.map((d) => d.code);
		expect(codes.filter((code) => code === "typespec-http-zod/shared-input-key")).toHaveLength(
			PAIRS.length,
		);
		expect(codes.filter((code) => code === "typespec-http-mcp/shared-input-key")).toHaveLength(
			PAIRS.length,
		);
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	});

	for (const [operation, pair] of PAIRS) {
		it(`${operation}: names ${pair}, and is not a tool`, () => {
			const message = compiled.messages.find(
				(d) =>
					d.code === "typespec-http-mcp/shared-input-key" &&
					d.message.startsWith(`'${operation}' `),
			)?.message;
			expect(message).toContain(pair);
			expect(generated.TOOL_NAMES).not.toContain(operation);
		});
	}

	it("keeps an operation whose inputs are all distinct, and a request body declared empty", () => {
		expect([...generated.TOOL_NAMES].toSorted()).toEqual(["control", "neverBody", "voidBody"]);
	});
});
