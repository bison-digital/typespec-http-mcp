import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **The surface a real client sees, driven end to end through emitted output.**
 *
 * Every other arm in this package grades a file or a type. None of them answers the question a
 * consumer actually has: *does a caller with one grant see a different tool list from a caller with
 * another?* That is the whole point of consulting `permits` at registration, and nothing here has
 * ever run it.
 */

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const MCP_PROTOCOL_VERSION = "2026-07-28";
const META = {
	"io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
	"io.modelcontextprotocol/clientInfo": { name: "acceptance", version: "0" },
	"io.modelcontextprotocol/clientCapabilities": {},
};

interface Generated {
	readonly registerTools: (
		server: McpServer,
		handlersFor: (context: unknown) => Record<string, unknown>,
		deps: Record<string, unknown>,
	) => readonly string[];
	readonly TOOL_NAMES: readonly string[];
	readonly SCOPES_SUPPORTED: readonly string[];
}

let generated: Generated;

beforeAll(async () => {
	const { outDir, diagnostics } = await compileFixture(
		join(packageRoot, "test", "agreement"),
		"service",
		{ outName: "acceptance" },
	);
	expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	generated = (await import(join(outDir, "mcp.gen.ts"))) as unknown as Generated;
}, 300_000);

/** A few bytes with a PNG signature, which is all an image block needs to carry. */
const PICTURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Every handler the fixture declares, returning a response the document declares for it. */
function handlersFor(): Record<string, unknown> {
	const widget = { id: "1", name: "a", colour: "grey" };
	return {
		reindex: () => ({ status: 204 }),
		health: () => ({ status: 200, body: { status: "ok" } }),
		WidgetTools_list: () => ({
			status: 200,
			body: { items: [widget], total: 1 },
			headers: { "x-total-count": 1 },
		}),
		WidgetTools_read: (_ctx: unknown, input: { widgetId: string }) =>
			input.widgetId === "missing"
				? { status: 404, body: { resource: input.widgetId } }
				: { status: 200, body: widget },
		WidgetTools_create: () => ({ status: 201, body: widget }),
		// `default` governs 202. Its body must be a Problem, as the document says, AND a Widget, as the
		// tool published: one carrying both is answered, a Problem alone is refused.
		WidgetTools_replace: (_ctx: unknown, input: { widgetId: string }) =>
			input.widgetId === "accepted"
				? { status: 202, body: { ...widget, code: "accepted", message: "queued" } }
				: input.widgetId === "malformed"
					? { status: 202, body: { code: "x", message: "not a widget" } }
					: { status: 200, body: widget },
		WidgetTools_picture: () => ({
			status: 200,
			// A type inside the `image/*` range, not the exact `image/png` beside it.
			contentType: "image/webp",
			body: new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(PICTURE);
					controller.close();
				},
			}),
		}),
		WidgetTools_label: () => ({ status: 200, body: "widget one" }),
		WidgetTools_remove: () => ({ status: 204 }),
	};
}

/** A grant, as an application would model one. */
interface Grant {
	readonly schemes: readonly string[];
	readonly scopes: readonly string[];
}

/**
 * The wiring a consumer is told to write. **`deps` is built from the FACTORY's context**, so the
 * grant reaches `permits` -- which is the only way per-caller filtering can work.
 */
function handlerFor(grant: Grant) {
	return createMcpHandler((context: { authInfo?: { scopes?: readonly string[] } }) => {
		const server = new McpServer({ name: "widgets", version: "1.0.0" });
		const scopes = context?.authInfo?.scopes ?? grant.scopes;
		const deps = {
			permits: (requirements: readonly Record<string, readonly string[]>[]) =>
				requirements.length === 0 ||
				requirements.some((requirement) =>
					Object.entries(requirement).every(
						([scheme, needed]) =>
							grant.schemes.includes(scheme) && needed.every((s) => scopes.includes(s)),
					),
				),
			context: () => ({}),
			noContext: () => ({ content: [{ type: "text", text: "no caller" }], isError: true }),
		};
		generated.registerTools(server, handlersFor, deps);
		return server;
	});
}

async function rpc(grant: Grant, method: string, params: Record<string, unknown> = {}) {
	const body = { jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: META } };
	const request = new Request("https://example.test/mcp", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			host: "example.test",
			"mcp-protocol-version": MCP_PROTOCOL_VERSION,
			"mcp-method": method,
			...(typeof params["name"] === "string" ? { "mcp-name": params["name"] } : {}),
		},
		body: JSON.stringify(body),
	});
	const response = await handlerFor(grant).fetch(request, {
		authInfo: { token: "t", clientId: "c", scopes: [...grant.scopes] },
	});
	return { status: response.status, json: JSON.parse(await response.text()) };
}

const toolsOf = (json: { result?: { tools?: { name: string }[] } }) =>
	(json.result?.tools ?? []).map((tool) => tool.name).toSorted();

const BEARER: Grant = { schemes: ["BearerAuth"], scopes: [] };
const SCOPED: Grant = { schemes: ["OAuth2Auth"], scopes: ["widgets.read", "widgets.write"] };
const NOBODY: Grant = { schemes: [], scopes: [] };

describe("a real client, over the wire, against emitted output", () => {
	it("lists the tools the emitter says it registered", async () => {
		const { status, json } = await rpc(BEARER, "tools/list");
		expect(status).toBe(200);
		expect(toolsOf(json)).toEqual([...generated.TOOL_NAMES].toSorted());
	});

	it("calls one, and the handler's value comes back as structured content", async () => {
		const { status, json } = await rpc(BEARER, "tools/call", {
			name: "WidgetTools_read",
			arguments: { widgetId: "1" },
		});
		expect(status).toBe(200);
		expect(json.result.structuredContent).toEqual({ id: "1", name: "a", colour: "grey" });
	});

	it("answers a declared 404 as a tool-execution error, with the failure's own body", async () => {
		const { status, json } = await rpc(BEARER, "tools/call", {
			name: "WidgetTools_read",
			arguments: { widgetId: "missing" },
		});
		expect(status).toBe(200);
		expect(json.result.isError).toBe(true);
		expect(json.result.structuredContent).toBeUndefined();
		expect(json.result.content).toEqual([
			{ type: "text", text: JSON.stringify({ resource: "missing" }) },
		]);
	});

	/**
	 * **Two success statuses with different bodies publish no `outputSchema`, and this is why.**
	 *
	 * The SDK server refuses a result that is not an error and carries no `structuredContent` once a
	 * tool declares an `outputSchema` ("Output validation error"), and a `201` whose body is not the
	 * `200`'s cannot carry the `200`'s schema. Published anyway, the declared `201` would reach the
	 * caller as a failure.
	 */
	it("answers a second success status with its own body, which a published outputSchema would refuse", async () => {
		const listed = (await rpc(BEARER, "tools/list")).json as {
			result: { tools: { name: string; outputSchema?: unknown }[] };
		};
		const create = listed.result.tools.find((tool) => tool.name === "WidgetTools_create");
		expect(create).toBeDefined();
		expect(create?.outputSchema).toBeUndefined();
		// Non-vacuity: a tool whose successes share one body still publishes its schema.
		const replace = listed.result.tools.find((tool) => tool.name === "WidgetTools_replace");
		expect(replace?.outputSchema).toBeDefined();

		const { json } = await rpc(BEARER, "tools/call", {
			name: "WidgetTools_create",
			arguments: { name: "b" },
		});
		expect(json.result.isError).toBeUndefined();
		expect(json.result.content).toEqual([
			{ type: "text", text: JSON.stringify({ id: "1", name: "a", colour: "grey" }) },
		]);
	});

	it("answers image bytes from a stream as an image block, over the wire", async () => {
		const { json } = await rpc(BEARER, "tools/call", {
			name: "WidgetTools_picture",
			arguments: { widgetId: "1" },
		});
		expect(json.result.isError).toBeUndefined();
		expect(json.result.content).toEqual([
			{ type: "image", data: Buffer.from(PICTURE).toString("base64"), mimeType: "image/webp" },
		]);
	});

	it("answers a text body as a text block, over the wire", async () => {
		const { json } = await rpc(BEARER, "tools/call", {
			name: "WidgetTools_label",
			arguments: { widgetId: "1" },
		});
		expect(json.result.content).toEqual([{ type: "text", text: "widget one" }]);
	});

	/**
	 * **A success `default` governs meets the published schema, or fails by name.** Without the check,
	 * the second call would reach the caller as the SDK's "has an output schema but no structured
	 * content was provided", which names neither the operation's contract nor the body.
	 */
	it("answers a 2xx through default against the published outputSchema, over the wire", async () => {
		const accepted = await rpc(BEARER, "tools/call", {
			name: "WidgetTools_replace",
			arguments: { widgetId: "accepted", name: "a" },
		});
		expect(accepted.json.result.isError, JSON.stringify(accepted.json)).toBeUndefined();
		expect(accepted.json.result.structuredContent).toEqual({ id: "1", name: "a", colour: "grey" });

		const malformed = await rpc(BEARER, "tools/call", {
			name: "WidgetTools_replace",
			arguments: { widgetId: "malformed", name: "a" },
		});
		expect(malformed.json.result.isError).toBe(true);
		expect(malformed.json.result.content[0].text).toBe(
			"WidgetTools_replace answered 202 with a body its document does not permit",
		);
	});

	it("carries a success's response header in _meta, by its wire name", async () => {
		const { json } = await rpc(BEARER, "tools/call", { name: "WidgetTools_list", arguments: {} });
		// The SDK adds its own `serverInfo` beside it, so the key is read rather than the whole slot.
		expect(json.result._meta["typespec-http-mcp/response-headers"]).toEqual({ "x-total-count": 1 });
		expect(json.result.structuredContent).toEqual({
			items: [{ id: "1", name: "a", colour: "grey" }],
			total: 1,
		});
	});

	/**
	 * **The arm this suite exists for.** `permits` is consulted when the server is built, so the grant
	 * has to reach the factory. Wired the way the docs once showed -- `deps` at module scope, a
	 * zero-argument factory -- every caller sees an identical list and this fails.
	 */
	it("shows a caller only the tools their grant permits", async () => {
		const scoped = toolsOf((await rpc(SCOPED, "tools/list")).json);
		const anonymous = toolsOf((await rpc(NOBODY, "tools/list")).json);

		expect(scoped.length).toBeGreaterThan(anonymous.length);
		// The fixture's operations all demand a scheme, so a caller with none sees nothing.
		expect(anonymous).toEqual([]);
	});

	it("answers an empty grant with a well-formed empty list, never an error", async () => {
		const { status, json } = await rpc(NOBODY, "tools/list");
		expect(status).toBe(200);
		expect(json.error).toBeUndefined();
		expect(json.result.tools).toEqual([]);
	});

	it("publishes the scopes the document declares", () => {
		expect([...generated.SCOPES_SUPPORTED]).toEqual(["widgets.read", "widgets.write"]);
	});
});
