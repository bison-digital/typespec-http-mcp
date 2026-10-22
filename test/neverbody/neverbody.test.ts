import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **A request body declared `never` refuses the compile**, as the library's `never-body`. openapi3
 * publishes it as any JSON value, so a tool taking no body would contradict the document, and one
 * taking any value would contradict the declaration. 0.4.0 made it a tool with nothing to merge.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;

beforeAll(async () => {
	compiled = await compileFixture(here, "neverbody", { outName: "neverbody" });
}, 300_000);

describe("a request body declared `never`", () => {
	it("is refused by the library, once, as an error naming `void` as the fix", () => {
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([
			{ code: "typespec-http-zod/never-body", severity: "error" },
		]);
		const message = compiled.messages.find(
			(d) => d.code === "typespec-http-zod/never-body",
		)?.message;
		expect(message).toContain("'neverBody'");
		expect(message).toContain("Replace it with 'void'");
	});
});
