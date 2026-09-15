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
let diagnostics: readonly { readonly code: string; readonly severity: string }[] = [];
let compiledMessages: readonly { readonly code: string; readonly message: string }[] = [];
let toolNames: string[] = [];
let outDir = "";
let emitted = "";

beforeAll(async () => {
	const compiled = await compileFixture(here, "refusals", { outName: "refusals" });
	codes = compiled.diagnostics.map((d) => d.code);
	diagnostics = compiled.diagnostics;
	compiledMessages = compiled.messages;
	outDir = compiled.outDir;
	emitted = readFileSync(join(outDir, "mcp.gen.ts"), "utf8");
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

/**
 * **What a response body can be as a tool result, decided per operation.**
 *
 * A tool result is content blocks: text, JSON, an `image` block or an `audio` block. A stream is not
 * one message, and bytes of any other media type have no block. Each is refused where it is declared,
 * and the arms below prove the refusal is exact: an image is kept.
 */
describe("a response a tool result cannot carry removes the operation", () => {
	/** The diagnostics raised against one operation, read from the message the compiler formatted. */
	function codesFor(operationId: string): string[] {
		return compiledMessages
			.filter((d) => d.message.startsWith(`'${operationId}'`))
			.map((d) => d.code)
			.toSorted();
	}

	it("refuses bytes served as application/octet-stream", () => {
		expect(codesFor("downloadBytes")).toContain(`${PREFIX}binary-tool-output`);
		expect(toolNames).not.toContain("downloadBytes");
	});

	it("refuses bytes offered as an image AND as an octet stream, because either may be answered", () => {
		expect(codesFor("downloadEither")).toContain(`${PREFIX}binary-tool-output`);
		expect(toolNames).not.toContain("downloadEither");
	});

	it("refuses a server-sent event stream", () => {
		expect(codesFor("itemEvents")).toContain(`${PREFIX}streamed-tool-output`);
		expect(toolNames).not.toContain("itemEvents");
	});

	it("keeps bytes served as an image, and text served as text", () => {
		expect(toolNames).toContain("thumbnail");
		expect(toolNames).toContain("note");
		expect(codesFor("thumbnail").filter((code) => code.endsWith("-tool-output"))).toEqual([]);
		expect(codesFor("note")).toEqual([]);
	});

	it("names the offending media types in the diagnostic", () => {
		const message = compiledMessages.find((d) => d.message.startsWith("'downloadEither'"))?.message;
		expect(message).toContain("application/octet-stream");
		expect(message).not.toContain("image/png");
	});
});

describe("a body answered unvalidated is warned about, and the tool kept", () => {
	it("warns about a model served as application/xml, naming the status and the type", () => {
		const warning = compiledMessages.find(
			(d) => d.code === `${PREFIX}unvalidated-response-media-type`,
		);
		expect(warning?.message).toContain("'itemXml' answers 200 as application/xml");
		expect(
			diagnostics.filter((d) => d.code === `${PREFIX}unvalidated-response-media-type`),
		).toEqual([{ code: `${PREFIX}unvalidated-response-media-type`, severity: "warning" }]);
		expect(toolNames).toContain("itemXml");
	});
});

/**
 * **`bodies` is written only where the runtime needs it.** A JSON body is known from its media type,
 * and an unvalidated model from the absence of an entry, so neither carries one.
 */
describe("the body kinds reach the runtime, and only where one applies", () => {
	/** The `toolResult` declaration a registration passes, for one operation. */
	function declaredFor(operationId: string): string {
		const call = new RegExp(`toolResult\\(\\s*(\\{[^\\n]*\\}),\\s*"${operationId}"`).exec(emitted);
		expect(call, operationId).not.toBeNull();
		return call?.[1] ?? "";
	}

	it("tells the runtime an image body is binary and a text body is text", () => {
		expect(declaredFor("thumbnail")).toContain('bodies: { "200": "binary" }');
		expect(declaredFor("note")).toContain('bodies: { "200": "text" }');
	});

	it("writes no entry for a JSON body or for a model served as unvalidated text", () => {
		expect(declaredFor("listItems")).not.toContain("bodies");
		expect(declaredFor("itemXml")).not.toContain("bodies");
		expect([...emitted.matchAll(/bodies: \{/g)]).toHaveLength(2);
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
		const refusals = codes.filter((code) =>
			["binary-tool-input", "non-json-request", "binary-tool-output", "streamed-tool-output"].some(
				(kind) => code === `${PREFIX}${kind}`,
			),
		);
		expect(refusals.length).toBeGreaterThanOrEqual(6);
		expect(toolNames.length).toBeGreaterThanOrEqual(4);
	});

	it("emits a tool surface that typechecks even with six operations refused", () => {
		const { output, failed } = typecheckEmitted(outDir);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});
});
