import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **A description that emitted source cannot carry verbatim.** See `summary.tsp`.
 *
 * The rule lives in `typespec-http-zod`, beside `objectKey`, because both server emitters in this
 * estate interpolate spec-authored text into generated code and there is one right answer. The
 * ORACLE is duplicated on purpose: each package grades what it produces, which is the same split
 * the `HttpPart<File>` carve-out already uses.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let outDir: string;
let source: string;

beforeAll(async () => {
	const compiled = await compileFixture(here, "summary", { outName: "summarytext" });
	outDir = compiled.outDir;
	source = readFileSync(join(outDir, "mcp.gen.ts"), "utf8");
}, 300_000);

describe("a tool description that emitted source cannot carry verbatim", () => {
	it("does not stop the emitted file compiling", () => {
		const { output, failed } = typecheckEmitted(outDir);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});

	it("escapes the comment terminator in the JSDoc rather than losing the sentence", () => {
		expect(source).toContain("Returns a *\\/ b, which used to close the comment.");
	});

	it("renders a multi-line description as a multi-line block", () => {
		expect(source).toContain("\t * Reads an item.\n");
		expect(source).toContain("\t * The second line used to sit outside the comment.\n");
	});

	it("still renders an ordinary description on one line, so nothing else moved", () => {
		expect(source).toContain(
			"\t/** Reads an item, plainly, so the arms below compare something. */\n",
		);
	});

	/**
	 * **Non-vacuity, and the half that actually reaches a model.** The arms above read the comment.
	 * The manifest string is the one an LLM sees, it goes through `JSON.stringify`, and it must carry
	 * the author's text unescaped by the comment rule.
	 */
	it("leaves the runtime description a plain JSON string, terminator and all", () => {
		expect(source).toContain(
			JSON.stringify("Reads an item. Returns a */ b, which used to close the comment."),
		);
	});
});
