import { specTypeSchemas } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { type ResponseArm, statusOf, toolResult, type ToolResponses } from "../../src/runtime.js";

/**
 * **Every result this runtime produces, graded against the SDK's OWN schema.**
 *
 * Not against a shape written here. `specTypeSchemas.CallToolResult` is the specification's result
 * type as the SDK implements it, so this arm cannot agree with a mistake of mine -- and it is the
 * same schema the server validates against on the way out.
 */

const CallToolResult = specTypeSchemas.CallToolResult as unknown as {
	safeParse: (value: unknown) => { success: boolean; error?: unknown };
};

const widget = z.object({ id: z.string(), name: z.string() });

function parse(result: unknown): { success: boolean; error?: unknown } {
	return CallToolResult.safeParse(result);
}

describe("the SDK's schema is a real oracle here", () => {
	it("accepts a well-formed result and REFUSES a malformed one", () => {
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
		status: number;
		value: unknown;
	}[] = [
		{
			name: "a success with a body and a published output schema",
			declared: { arms: [{ status: 200, schema: widget }], outputSchema: widget },
			status: 200,
			value: { id: "1", name: "a" },
		},
		{
			name: "a success with a body and NO published output schema",
			declared: { arms: [{ status: 200, schema: widget }], outputSchema: undefined },
			status: 200,
			value: { id: "1", name: "a" },
		},
		{
			name: "a bodyless success",
			declared: { arms: [{ status: 204, schema: undefined }], outputSchema: undefined },
			status: 204,
			value: undefined,
		},
		{
			name: "a declared failure",
			declared: {
				arms: [
					{ status: 200, schema: widget },
					{ status: 404, schema: widget },
				],
				outputSchema: widget,
			},
			status: 404,
			value: { id: "1", name: "gone" },
		},
		{
			name: "a failure resolved through the catch-all arm",
			declared: {
				arms: [
					{ status: 200, schema: widget },
					{ status: "default", schema: widget },
				],
				outputSchema: widget,
			},
			status: 503,
			value: { id: "1", name: "down" },
		},
		{
			name: "a success carrying a declared response header",
			declared: {
				arms: [
					{
						status: 200,
						schema: widget,
						headers: [{ name: "x-page-token", property: "pageToken" }],
					},
				],
				outputSchema: widget,
			},
			status: 200,
			value: { id: "1", name: "a", pageToken: "next" },
		},
		{
			name: "an array body",
			declared: {
				arms: [{ status: 200, schema: z.array(widget) }],
				outputSchema: z.array(widget),
			},
			status: 200,
			value: [{ id: "1", name: "a" }],
		},
	];

	it.each(cases)("$name", ({ declared, status, value }) => {
		const result = toolResult(declared, status, value);
		const parsed = parse(result);
		expect(parsed.success, JSON.stringify(parsed.error)).toBe(true);
	});

	it("covers every case it claims to", () => {
		expect(cases.length).toBeGreaterThanOrEqual(7);
	});
});

describe("what toolResult decides, and why", () => {
	const arms: readonly ResponseArm[] = [
		{ status: 200, schema: widget },
		{ status: 404, schema: widget },
		{ status: "default", schema: widget },
	];
	const declared: ToolResponses = { arms, outputSchema: widget };
	const value = { id: "1", name: "a" };

	it("marks a declared 4xx or 5xx as a tool-execution error, and a 2xx as not", () => {
		expect(toolResult(declared, 200, value).isError).toBeUndefined();
		expect(toolResult(declared, 201, value).isError).toBeUndefined();
		expect(toolResult(declared, 404, value).isError).toBe(true);
		expect(toolResult(declared, 500, value).isError).toBe(true);
	});

	it("puts the boundary at exactly 400, which is where the status classes divide", () => {
		expect(toolResult(declared, 399, value).isError).toBeUndefined();
		expect(toolResult(declared, 400, value).isError).toBe(true);
	});

	it("publishes structuredContent only where an outputSchema was published", () => {
		expect(toolResult(declared, 200, value).structuredContent).toEqual(value);
		const none: ToolResponses = { arms, outputSchema: undefined };
		expect(toolResult(none, 200, value).structuredContent).toBeUndefined();
		// The text mirror is kept either way, which is what MCP recommends for older clients.
		expect(toolResult(none, 200, value).content).toHaveLength(1);
	});

	/**
	 * **A response header must not reach `structuredContent`.** It is not body, the library already
	 * stripped it from the body schema, and leaving it in would violate the very `outputSchema` that
	 * was derived from that schema.
	 */
	it("moves a declared response header out of the body and into _meta", () => {
		const withHeader: ToolResponses = {
			arms: [
				{
					status: 200,
					schema: widget,
					headers: [{ name: "x-page-token", property: "pageToken" }],
				},
			],
			outputSchema: widget,
		};
		const result = toolResult(withHeader, 200, { ...value, pageToken: "next" });
		expect(result.structuredContent).toEqual(value);
		expect(result._meta).toEqual({ "typespec-http-mcp/response-headers": { pageToken: "next" } });
		expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(value);
	});

	it("returns an empty content array for a bodyless arm, inventing no sentence", () => {
		const bodyless: ToolResponses = {
			arms: [{ status: 204, schema: undefined }],
			outputSchema: undefined,
		};
		const result = toolResult(bodyless, 204, undefined);
		expect(result.content).toEqual([]);
		expect(result.structuredContent).toBeUndefined();
	});
});

describe("statusOf reads the document's own selector", () => {
	it("answers the single declared success", () => {
		expect(statusOf([{ status: 200, schema: widget }], { id: "1" })).toBe(200);
		expect(statusOf([{ status: 204, schema: undefined }], undefined)).toBe(204);
	});

	it("chooses between two success arms by the property the document names", () => {
		const arms: readonly ResponseArm[] = [
			{ status: 201, schema: widget, when: { property: "created", value: true } },
			{ status: 200, schema: widget },
		];
		expect(statusOf(arms, { created: true })).toBe(201);
		expect(statusOf(arms, { created: false })).toBe(200);
	});

	it("ignores failure arms when deciding what a returned value means", () => {
		const arms: readonly ResponseArm[] = [
			{ status: 404, schema: widget },
			{ status: 200, schema: widget },
		];
		expect(statusOf(arms, { id: "1" })).toBe(200);
	});
});
