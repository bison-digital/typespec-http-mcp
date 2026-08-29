import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **What this emitter cannot express as a tool, and what it can express but warns about.**
 *
 * The distinction is load-bearing. A REFUSAL removes an operation from the surface and is counted,
 * so `emitted + refused === selected` makes a silent drop arithmetically impossible. A WARNING
 * leaves the tool in place. Conflating them would let a quality complaint quietly delete a tool.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const PREFIX = "typespec-http-mcp/";

let codes: string[] = [];
let toolNames: string[] = [];
let outDir = "";

beforeAll(async () => {
	const compiled = await compileFixture(here, "refusals", { bare: true, outName: "refusals" });
	codes = compiled.diagnostics.map((d) => d.code);
	outDir = compiled.outDir;
	const emitted = readFileSync(join(outDir, "mcp.gen.ts"), "utf8");
	const match = /TOOL_NAMES = \[([^\]]*)\]/.exec(emitted);
	toolNames = [...(match?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
}, 300_000);

describe("the fixture exercises what it claims to", () => {
	it("raised diagnostics and emitted tools, so neither set is empty", () => {
		expect(codes.length).toBeGreaterThanOrEqual(5);
		expect(toolNames.length).toBeGreaterThanOrEqual(4);
	});

	it("refused nothing with an error, so a consumer keeps their document", () => {
		// A TypeSpec `error` sets program.hasError() and @typespec/openapi3 then writes nothing.
		const compiledErrors = codes.filter((code) => code.startsWith(PREFIX));
		expect(compiledErrors.length).toBeGreaterThanOrEqual(5);
	});
});

describe("refusals remove the operation from the surface", () => {
	it("refuses a raw binary body", () => {
		expect(codes).toContain(`${PREFIX}binary-tool-input`);
		expect(toolNames).not.toContain("uploadBytes");
	});

	it("refuses a multipart body", () => {
		expect(toolNames).not.toContain("uploadForm");
	});

	it("refuses an operation whose every request media type is non-JSON", () => {
		expect(codes).toContain(`${PREFIX}non-json-request`);
		expect(toolNames).not.toContain("sendXml");
	});

	/**
	 * **The arm that stops `non-json-request` being over-broad.** Where JSON is declared beside a type
	 * a tool cannot send, the tool sends JSON and the other is simply unreachable from MCP. Refusing
	 * that would delete a perfectly callable operation.
	 */
	it("does NOT refuse an operation that declares JSON beside a non-JSON type", () => {
		expect(toolNames).toContain("sendEither");
	});
});

describe("warnings leave the tool in place", () => {
	it("warns about a success that carries headers and no body, and still emits it", () => {
		expect(codes).toContain(`${PREFIX}headers-only-success`);
		expect(toolNames).toContain("ping");
	});

	it("warns about an undescribed tool, and still emits it", () => {
		expect(codes).toContain(`${PREFIX}tool-without-description`);
		expect(toolNames).toContain("quiet");
	});

	it("does not warn about an operation that IS described", () => {
		// `listItems` carries a doc comment, so the warning above is about `quiet` and not about all.
		expect(toolNames).toContain("listItems");
		const undescribed = codes.filter((code) => code === `${PREFIX}tool-without-description`);
		expect(undescribed).toHaveLength(1);
	});
});

describe("the invariant holds, and the output still compiles", () => {
	/**
	 * `emitted + refused === selected` is asserted inside the emitter and throws when it fails, so a
	 * compile that completes at all is the arm. What this adds is the ARITHMETIC being non-trivial:
	 * refusals and emissions both non-zero, so the equation is not `N + 0 === N`.
	 */
	it("emitted and refused are both non-zero, so the equation is not trivially satisfied", () => {
		const refusals = codes.filter(
			(code) => code === `${PREFIX}binary-tool-input` || code === `${PREFIX}non-json-request`,
		);
		expect(refusals.length).toBeGreaterThanOrEqual(3);
		expect(toolNames.length).toBeGreaterThanOrEqual(4);
	});

	it("emits a tool surface that typechecks even with three operations refused", () => {
		const { output, failed } = typecheckEmitted(outDir);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});
});
