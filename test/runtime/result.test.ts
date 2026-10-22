import { specTypeSchemas } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	ResponseContractError,
	type ResponseArm,
	toolResult,
	type ToolResponses,
	UndeclaredStatusError,
} from "../../src/runtime.js";

/**
 * **Every result this runtime produces, graded against the SDK's OWN schema.**
 *
 * Not against a shape written here. `specTypeSchemas.CallToolResult` is the specification's result
 * type as the SDK implements it, so this arm cannot agree with a mistake of this runtime's -- and it
 * is the same schema the server validates against on the way out.
 */

const CallToolResult = specTypeSchemas.CallToolResult as unknown as {
	safeParse: (value: unknown) => { success: boolean; error?: unknown };
};

const widget = z.object({ id: z.string(), name: z.string() });
const problem = z.object({ code: z.string() });

function parse(result: unknown): { success: boolean; error?: unknown } {
	return CallToolResult.safeParse(result);
}

describe("the SDK's schema is a real oracle here", () => {
	it("accepts a well-formed result and REFUSES a malformed one", async () => {
		expect(parse({ content: [{ type: "text", text: "x" }] }).success).toBe(true);
		/**
		 * Without these, an oracle that accepted everything would grade every arm below as passing.
		 *
		 * **Measured, and narrower than assumed: `{}` is ACCEPTED**, because `content` is optional in
		 * the specification's result type -- a tool may answer with `structuredContent` alone. So the
		 * refusals below are the ones this oracle really makes, and an arm asserting that `{}` fails
		 * would have been asserting something untrue about the SDK rather than about this runtime.
		 * `toolResult` always emits `content` anyway, which is stricter than required and is what MCP
		 * recommends for clients that read only that field.
		 */
		expect(parse({ content: "not an array" }).success).toBe(false);
		expect(parse({ content: [{}] }).success).toBe(false);
		expect(parse({ content: [{ type: "text" }] }).success).toBe(false);
		expect(parse({ content: [], isError: "yes" }).success).toBe(false);
	});
});

describe("toolResult produces results the specification accepts", () => {
	const cases: readonly {
		name: string;
		declared: ToolResponses;
		result: unknown;
	}[] = [
		{
			name: "a success with a body and a published output schema",
			declared: { arms: [{ status: 200, schema: widget }], outputSchema: widget },
			result: { status: 200, body: { id: "1", name: "a" } },
		},
		{
			name: "a success with a body and NO published output schema",
			declared: { arms: [{ status: 200, schema: widget }], outputSchema: undefined },
			result: { status: 200, body: { id: "1", name: "a" } },
		},
		{
			name: "a bodyless success",
			declared: { arms: [{ status: 204, schema: undefined }], outputSchema: undefined },
			result: { status: 204 },
		},
		{
			name: "a declared failure",
			declared: {
				arms: [
					{ status: 200, schema: widget },
					{ status: 404, schema: problem },
				],
				outputSchema: widget,
			},
			result: { status: 404, body: { code: "gone" } },
		},
		{
			name: "a failure resolved through the catch-all arm",
			declared: {
				arms: [
					{ status: 200, schema: widget },
					{ status: "default", schema: problem },
				],
				outputSchema: widget,
			},
			result: { status: 503, body: { code: "down" } },
		},
		{
			name: "a success carrying a declared response header",
			declared: {
				arms: [
					{
						status: 200,
						schema: widget,
						contentTypes: ["application/json"],
						headers: [{ name: "x-page-token", optional: false }],
					},
				],
				outputSchema: widget,
			},
			result: { status: 200, body: { id: "1", name: "a" }, headers: { "x-page-token": "next" } },
		},
		{
			name: "an array body",
			declared: {
				arms: [{ status: 200, schema: z.array(widget) }],
				outputSchema: undefined,
			},
			result: { status: 200, body: [{ id: "1", name: "a" }] },
		},
		{
			name: "a text body under a media type that is not JSON",
			declared: {
				arms: [{ status: 200, schema: z.string(), contentTypes: ["text/plain"] }],
				outputSchema: undefined,
			},
			result: { status: 200, body: "plain" },
		},
	];

	it.each(cases)("$name", async ({ declared, result }) => {
		const parsed = parse(await toolResult(declared, "op", result));
		expect(parsed.success, JSON.stringify(parsed.error)).toBe(true);
	});

	it("covers every case it claims to", async () => {
		expect(cases.length).toBeGreaterThanOrEqual(8);
	});
});

describe("what toolResult decides, and why", () => {
	const arms: readonly ResponseArm[] = [
		{ status: 200, schema: widget, contentTypes: ["application/json"] },
		{ status: 404, schema: problem, contentTypes: ["application/json"] },
		{ status: "default", schema: problem, contentTypes: ["application/problem+json"] },
	];
	const declared: ToolResponses = { arms, outputSchema: widget };
	const body = { id: "1", name: "a" };

	it("marks a declared 4xx or 5xx as a tool-execution error, and a 2xx as not", async () => {
		expect((await toolResult(declared, "op", { status: 200, body })).isError).toBeUndefined();
		expect((await toolResult(declared, "op", { status: 404, body: { code: "x" } })).isError).toBe(
			true,
		);
		expect((await toolResult(declared, "op", { status: 500, body: { code: "x" } })).isError).toBe(
			true,
		);
	});

	/**
	 * **A media type is compared by its essence**, as the library and the server emitter compare it:
	 * `application/json; charset=utf-8` is JSON. Compared as a whole string, it was answered as text the
	 * handler supplies, and a handler returning the model was refused.
	 */
	it("answers JSON declared with a parameter or in capitals as JSON", async () => {
		for (const type of ["application/json; charset=utf-8", "Application/JSON"]) {
			const declared: ToolResponses = {
				arms: [{ status: 200, schema: widget, contentTypes: [type] }],
				outputSchema: widget,
			};
			const result = await toolResult(declared, "op", { status: 200, body });
			expect(result.structuredContent).toEqual(body);
			expect(result.content).toEqual([{ type: "text", text: JSON.stringify(body) }]);
		}
	});

	it("puts the boundary at exactly 400, which is where the status classes divide", async () => {
		// No published schema, so a 399 through `default` is answered on its own terms.
		const declared: ToolResponses = { arms, outputSchema: undefined };
		expect(
			(await toolResult(declared, "op", { status: 399, body: { code: "x" } })).isError,
		).toBeUndefined();
		expect((await toolResult(declared, "op", { status: 400, body: { code: "x" } })).isError).toBe(
			true,
		);
	});

	it("publishes structuredContent only for the arm whose schema was published", async () => {
		expect((await toolResult(declared, "op", { status: 200, body })).structuredContent).toEqual(
			body,
		);
		const none: ToolResponses = { arms, outputSchema: undefined };
		expect((await toolResult(none, "op", { status: 200, body })).structuredContent).toBeUndefined();
		// The text mirror is kept either way, which is what MCP recommends for older clients.
		expect((await toolResult(none, "op", { status: 200, body })).content).toHaveLength(1);
		// A failure's body does not conform to the success schema the tool published.
		const failure = await toolResult(declared, "op", { status: 404, body: { code: "gone" } });
		expect(failure.structuredContent).toBeUndefined();
	});

	/**
	 * **What is answered is the PARSED body.** A schema that strips undeclared keys strips them here
	 * too, so a field the document does not publish does not reach a model.
	 */
	it("answers the parsed body, so an undeclared field does not reach the model", async () => {
		const result = await toolResult(declared, "op", {
			status: 200,
			body: { ...body, tenant: "t-1" },
		});
		expect(result.structuredContent).toEqual(body);
		expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(body);
	});

	it("returns an empty content array for a bodyless arm, inventing no sentence", async () => {
		const bodyless: ToolResponses = {
			arms: [{ status: 204, schema: undefined }],
			outputSchema: undefined,
		};
		const result = await toolResult(bodyless, "op", { status: 204 });
		expect(result.content).toEqual([]);
		expect(result.structuredContent).toBeUndefined();
	});
});

/**
 * **Request-level arms: what one handler result becomes, end to end through the runtime.**
 *
 * The arms an operation publishes are the ones `schemas.gen.ts` writes for `Widget | NotFound | Problem`
 * with a header on the success and a range with an optional header, so each assertion is about a
 * result a generated tool actually hands to `toolResult`.
 */
describe("a handler's result, served as a tool result", () => {
	const notFound = z.object({ resource: z.string() });
	const detail = z.object({ message: z.string() });
	const declared: ToolResponses = {
		arms: [
			{
				status: 200,
				schema: widget,
				contentTypes: ["application/json"],
				headers: [{ name: "x-total-count", optional: false }],
			},
			{ status: 404, schema: notFound, contentTypes: ["application/json"] },
			{
				status: "4XX",
				schema: detail,
				contentTypes: ["application/json"],
				headers: [{ name: "retry-after", optional: true }],
			},
			{ status: "default", schema: problem, contentTypes: ["application/json"] },
		],
		outputSchema: widget,
	};

	it("serves a declared 404 as a tool-execution error carrying its own body", async () => {
		const result = await toolResult(declared, "WidgetTools_read", {
			status: 404,
			body: { resource: "w-9" },
		});
		expect(parse(result).success).toBe(true);
		expect(result.isError).toBe(true);
		expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ resource: "w-9" }) }]);
		expect(result.structuredContent).toBeUndefined();
	});

	it("throws UndeclaredStatusError for a status no arm governs", async () => {
		const narrow: ToolResponses = {
			arms: [
				{ status: 200, schema: widget },
				{ status: 404, schema: notFound },
			],
			outputSchema: widget,
		};
		const answer = { status: 500, body: { code: "x" } };
		await expect(toolResult(narrow, "WidgetTools_read", answer)).rejects.toThrow(
			UndeclaredStatusError,
		);
		try {
			await toolResult(narrow, "WidgetTools_read", answer);
			expect.unreachable("an undeclared status was answered");
		} catch (error) {
			expect(error).toMatchObject({ operationId: "WidgetTools_read", result: answer });
			expect((error as Error).message).toBe(
				"WidgetTools_read answered 500, which its document does not declare",
			);
		}
		// A result with no status at all is as undeclared, which is what a cast produces.
		await expect(toolResult(narrow, "WidgetTools_read", { body: {} })).rejects.toThrow(
			UndeclaredStatusError,
		);
	});

	it("throws ResponseContractError for a body its status's schema refuses", async () => {
		const answer = { status: 200, body: { id: 1 }, headers: { "x-total-count": 1 } };
		await expect(toolResult(declared, "WidgetTools_read", answer)).rejects.toThrow(
			ResponseContractError,
		);
		try {
			await toolResult(declared, "WidgetTools_read", answer);
			expect.unreachable("a body its schema refuses was answered");
		} catch (error) {
			expect(error).toBeInstanceOf(ResponseContractError);
			const contract = error as ResponseContractError;
			expect(contract.operationId).toBe("WidgetTools_read");
			expect(contract.status).toBe(200);
			expect(contract.issues.map((issue) => issue.path.join("."))).toEqual(["id", "name"]);
		}
		// Failures are checked too: the 4XX range's body, not the success's.
		await expect(
			toolResult(declared, "WidgetTools_read", { status: 429, body: { resource: "w" } }),
		).rejects.toThrow(ResponseContractError);
	});

	it("carries declared headers in _meta, keyed by their wire names", async () => {
		const success = await toolResult(declared, "WidgetTools_read", {
			status: 200,
			body: { id: "1", name: "a" },
			headers: { "x-total-count": 3 },
		});
		expect(success._meta).toEqual({ "typespec-http-mcp/response-headers": { "x-total-count": 3 } });
		expect(success.structuredContent).toEqual({ id: "1", name: "a" });

		const throttled = await toolResult(declared, "WidgetTools_read", {
			status: 429,
			body: { message: "slow" },
			headers: { "retry-after": 30 },
		});
		expect(throttled._meta).toEqual({
			"typespec-http-mcp/response-headers": { "retry-after": 30 },
		});
		expect(throttled.isError).toBe(true);

		// An optional header left out is omitted, and nothing is invented in its place.
		const bare = await toolResult(declared, "WidgetTools_read", {
			status: 429,
			body: { message: "slow" },
		});
		expect(bare._meta).toBeUndefined();
		expect(parse(bare).success).toBe(true);
	});
});

/**
 * **Each body kind a document can declare, answered as the MCP content block for it.**
 *
 * The arms are the ones `schemas.gen.ts` writes and the `bodies` entries the emitter writes beside
 * them: a string as `text/plain`, a model as `application/xml`, bytes as `image/png`, `image/*` and
 * `audio/mpeg`. Every result is also graded against the SDK's own schema, so a block this runtime
 * invents cannot pass.
 */
describe("a body that is not JSON, answered as the block its kind is", () => {
	const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
	const pngBase64 = Buffer.from(png).toString("base64");

	const text: ToolResponses = {
		arms: [{ status: 200, schema: z.string().min(2), contentTypes: ["text/plain"] }],
		outputSchema: undefined,
		bodies: { "200": { "text/plain": "text" } },
	};

	it("answers a text body as the parsed string, in a text block", async () => {
		const result = await toolResult(text, "text", { status: 200, body: "plain" });
		expect(parse(result).success).toBe(true);
		expect(result.content).toEqual([{ type: "text", text: "plain" }]);
	});

	it("throws ResponseContractError for a text body its schema refuses", async () => {
		await expect(toolResult(text, "text", { status: 200, body: "x" })).rejects.toThrow(
			ResponseContractError,
		);
		// Non-vacuity: the same body under the same arm, with no `text` entry, is answered unvalidated.
		const unvalidated: ToolResponses = { ...text, bodies: {} };
		expect((await toolResult(unvalidated, "text", { status: 200, body: "x" })).content).toEqual([
			{ type: "text", text: "x" },
		]);
	});

	it("answers a model served as text unvalidated, and refuses anything that is not that text", async () => {
		const xml: ToolResponses = {
			arms: [
				{ status: 200, schema: z.object({ id: z.string() }), contentTypes: ["application/xml"] },
			],
			outputSchema: undefined,
		};
		const result = await toolResult(xml, "xml", { status: 200, body: "<item><id>1</id></item>" });
		expect(parse(result).success).toBe(true);
		expect(result.content).toEqual([{ type: "text", text: "<item><id>1</id></item>" }]);
		await expect(toolResult(xml, "xml", { status: 200, body: { id: "1" } })).rejects.toThrow(
			ResponseContractError,
		);
	});

	const image: ToolResponses = {
		arms: [{ status: 200, schema: z.unknown(), contentTypes: ["image/png"] }],
		outputSchema: undefined,
		bodies: { "200": { "image/png": "binary" } },
	};

	it("answers image bytes as an image block, from a Uint8Array and from an ArrayBuffer", async () => {
		for (const body of [png, png.buffer.slice(0)]) {
			const result = await toolResult(image, "png", { status: 200, body });
			expect(parse(result).success).toBe(true);
			expect(result.content).toEqual([{ type: "image", data: pngBase64, mimeType: "image/png" }]);
		}
	});

	it("answers an image stream as the same block, buffered to its end", async () => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(png.subarray(0, 4));
				controller.enqueue(png.subarray(4));
				controller.close();
			},
		});
		const result = await toolResult(image, "png", { status: 200, body: stream });
		expect(parse(result).success).toBe(true);
		expect(result.content).toEqual([{ type: "image", data: pngBase64, mimeType: "image/png" }]);
	});

	/**
	 * **Any stream of `Uint8Array` chunks, not only the platform's**, because the result type admits
	 * the contract's structural `ByteStream`. Read to its end, and the reader released.
	 */
	it("answers a stream that is only a reader as the same block, and releases it", async () => {
		const chunks = [png.subarray(0, 3), png.subarray(3)];
		let released = 0;
		const stream = {
			getReader: () => ({
				read: async () => {
					const value = chunks.shift();
					return value === undefined ? { done: true } : { done: false, value };
				},
				releaseLock: () => {
					released += 1;
				},
			}),
		};
		const result = await toolResult(image, "png", { status: 200, body: stream });
		expect(parse(result).success).toBe(true);
		expect(result.content).toEqual([{ type: "image", data: pngBase64, mimeType: "image/png" }]);
		expect(released).toBe(1);
	});

	it("refuses a stream whose chunk is not bytes, cancels it and releases it", async () => {
		let released = 0;
		let cancelled = false;
		const stream = {
			getReader: () => ({
				read: async () => ({ done: false, value: "not bytes" }),
				releaseLock: () => {
					released += 1;
				},
				cancel: async () => {
					cancelled = true;
				},
			}),
		};
		await expect(toolResult(image, "png", { status: 200, body: stream })).rejects.toThrow(
			ResponseContractError,
		);
		expect(released).toBe(1);
		// The producer is told it will not be read further, not only abandoned.
		expect(cancelled).toBe(true);
	});

	/** A read may report no chunk and not be done, which `ByteStream` admits: it carries nothing. */
	it("reads past a read that carries no chunk", async () => {
		const reads = [{ done: false }, { done: false, value: png }, { done: true }];
		const stream = {
			getReader: () => ({
				read: async () => reads.shift() ?? { done: true },
				releaseLock: () => {},
			}),
		};
		const result = await toolResult(image, "png", { status: 200, body: stream });
		expect(result.content).toEqual([{ type: "image", data: pngBase64, mimeType: "image/png" }]);
	});

	it("names the media type the handler chose inside a range", async () => {
		const range: ToolResponses = {
			arms: [{ status: 200, schema: z.unknown(), contentTypes: ["image/*"] }],
			outputSchema: undefined,
			bodies: { "200": { "image/*": "binary" } },
		};
		const result = await toolResult(range, "anyImage", {
			status: 200,
			contentType: "image/webp",
			body: png,
		});
		expect(result.content).toEqual([{ type: "image", data: pngBase64, mimeType: "image/webp" }]);
		// A type outside the range is as undeclared as a status.
		await expect(
			toolResult(range, "anyImage", { status: 200, contentType: "audio/mpeg", body: png }),
		).rejects.toThrow(UndeclaredStatusError);
		// Nor is the range's own spelling, or a type with no subtype: neither is a type a body is sent as.
		for (const contentType of ["image/*", "image/"]) {
			await expect(
				toolResult(range, "anyImage", { status: 200, contentType, body: png }),
			).rejects.toThrow(UndeclaredStatusError);
		}
	});

	/**
	 * **A file is bytes whatever its media type**, as the library places it, so one declared
	 * `application/json` is not parsed and re-serialised: its bytes, as JSON, became an object of
	 * numbered keys.
	 */
	it("answers a file declared as JSON as its bytes, embedded", async () => {
		const file: ToolResponses = {
			arms: [{ status: 200, schema: z.unknown(), contentTypes: ["application/json"] }],
			outputSchema: undefined,
			bodies: { "200": { "application/json": "binary" } },
		};
		const result = await toolResult(file, "jsonFile", { status: 200, body: png });
		expect(parse(result).success).toBe(true);
		expect(result.content).toEqual([
			{
				type: "resource",
				resource: {
					uri: "resource://tool-response/jsonFile",
					mimeType: "application/json",
					blob: pngBase64,
				},
			},
		]);
	});

	/**
	 * **One status may offer one model as text and as bytes**: as XML, the text the handler writes,
	 * and as `application/octet-stream`, its bytes. The kind is the served media type's, so each is
	 * answered as what it is.
	 */
	it("answers a model as text under XML and as bytes under octet-stream, on one status", async () => {
		const both: ToolResponses = {
			arms: [
				{
					status: 200,
					schema: z.object({ id: z.string() }),
					contentTypes: ["application/xml", "application/octet-stream"],
				},
			],
			outputSchema: undefined,
			bodies: { "200": { "application/octet-stream": "binary" } },
		};
		const asText = await toolResult(both, "both", {
			status: 200,
			contentType: "application/xml",
			body: "<item/>",
		});
		expect(asText.content).toEqual([{ type: "text", text: "<item/>" }]);
		const asBytes = await toolResult(both, "both", {
			status: 200,
			contentType: "application/octet-stream",
			body: png,
		});
		expect(parse(asBytes).success).toBe(true);
		expect(asBytes.content).toEqual([
			{
				type: "resource",
				resource: {
					uri: "resource://tool-response/both",
					mimeType: "application/octet-stream",
					blob: pngBase64,
				},
			},
		]);
	});

	it("answers audio bytes as an audio block", async () => {
		const audio: ToolResponses = {
			arms: [{ status: 200, schema: z.unknown(), contentTypes: ["audio/mpeg"] }],
			outputSchema: undefined,
			bodies: { "200": { "audio/mpeg": "binary" } },
		};
		const result = await toolResult(audio, "mp3", { status: 200, body: png });
		expect(parse(result).success).toBe(true);
		expect(result.content).toEqual([{ type: "audio", data: pngBase64, mimeType: "audio/mpeg" }]);
	});

	it("refuses a binary body that is not bytes", async () => {
		await expect(toolResult(image, "png", { status: 200, body: "not bytes" })).rejects.toThrow(
			ResponseContractError,
		);
	});

	/**
	 * **Bytes no other block carries are an embedded resource**, a blob with its media type. Its `uri`
	 * is required and names this operation's response; nothing resolves it, which the specification
	 * allows of a resource a tool embeds (`resources` is a SHOULD), and which `typespec-http-mcp`
	 * says in the URI rather than pointing at a server it does not run.
	 */
	it("answers bytes no other block carries as an embedded resource, with the bytes and the type", async () => {
		for (const type of ["application/octet-stream", "application/pdf"]) {
			const declared: ToolResponses = {
				arms: [{ status: 200, schema: z.unknown(), contentTypes: [type] }],
				outputSchema: undefined,
				bodies: { "200": { [type]: "binary" } },
			};
			const result = await toolResult(declared, "manual", { status: 200, body: png });
			expect(parse(result).success).toBe(true);
			expect(result.content).toEqual([
				{
					type: "resource",
					resource: { uri: "resource://tool-response/manual", mimeType: type, blob: pngBase64 },
				},
			]);
		}
	});
});

/**
 * **A success `default` covers either meets the published `outputSchema` or fails by name.**
 *
 * The emitter publishes an `outputSchema` for the common `Widget | Problem` shape, whose `default`
 * arm types every unlisted status, 2xx included. The SDK refuses a success without
 * `structuredContent` once a schema is published, so such a success is held to that schema here.
 */
describe("a success through default, where an outputSchema is published", () => {
	const declared: ToolResponses = {
		arms: [
			{ status: 200, schema: widget, contentTypes: ["application/json"] },
			{
				status: "default",
				schema: z.object({ id: z.string() }),
				contentTypes: ["application/json"],
			},
		],
		outputSchema: widget,
	};

	it("answers it as structuredContent when its body meets the published schema", async () => {
		const result = await toolResult(declared, "op", {
			status: 202,
			body: { id: "1", name: "a", extra: true },
		});
		expect(parse(result).success).toBe(true);
		expect(result.isError).toBeUndefined();
		expect(result.structuredContent).toEqual({ id: "1", name: "a" });
		// The text mirror is what structuredContent carries, not the default arm's narrower parse.
		expect(result.content).toEqual([
			{ type: "text", text: JSON.stringify({ id: "1", name: "a" }) },
		]);
	});

	it("throws ResponseContractError with the published schema's issues when it does not", async () => {
		try {
			await toolResult(declared, "op", { status: 202, body: { id: "1" } });
			expect.unreachable("a success the published schema refuses was answered");
		} catch (error) {
			expect(error).toBeInstanceOf(ResponseContractError);
			const contract = error as ResponseContractError;
			expect(contract.status).toBe(202);
			expect(contract.issues.map((issue) => issue.path.join("."))).toEqual(["name"]);
		}
	});

	it("leaves a failure through default alone, which the SDK does not check", async () => {
		const result = await toolResult(declared, "op", { status: 503, body: { id: "x" } });
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toBeUndefined();
	});
});
