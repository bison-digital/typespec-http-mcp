import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **That what this emitter writes actually compiles, under the settings a consumer builds with.**
 *
 * Every other arm reads emitted text. Text cannot answer the question a consumer asks -- "can I hand
 * my own value to this type" -- and in the sibling packages a defect only a compiler could see
 * shipped for exactly that reason.
 */

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const reference = join(packageRoot, "test", "reference");

describe("the emitted tool surface compiles", () => {
	it("typechecks under strict, exactOptionalPropertyTypes and types: []", async () => {
		const { outDir, diagnostics } = await compileFixture(reference, "service", {
			outName: "emit-reference",
		});
		expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		const { output, failed } = typecheckEmitted(outDir);
		expect(output).toBe("");
		expect(failed).toBe(false);
	}, 300_000);

	it("typechecks with seal-object-schemas, which changes every emitted object", async () => {
		const { outDir } = await compileFixture(reference, "service", {
			outName: "emit-sealed",
			extraOptions: { "seal-object-schemas": true },
		});
		const { output, failed } = typecheckEmitted(outDir);
		expect(output).toBe("");
		expect(failed).toBe(false);
	}, 300_000);
});
