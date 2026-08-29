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
let runtime: { toolResult: Function; statusOf: Function };

beforeAll(async () => {
	const { outDir, diagnostics } = await compileFixture(
		join(packageRoot, "test", "agreement"),
		"service",
		{ bare: true, outName: "acceptance" },
	);
	expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	generated = (await import(join(outDir, "mcp.gen.ts"))) as unknown as Generated;
	runtime = (await import(join(outDir, "mcp-runtime.gen.ts"))) as never;
}, 300_000);

/** Every handler the fixture declares, returning something shaped like its response. */
function handlersFor(): Record<string, unknown> {
	const widget = { id: "1", name: "a", colour: "grey" };
	return {
		reindex: () => undefined,
		health: () => ({ status: "ok" }),
		WidgetTools_list: () => ({ items: [widget], total: 1 }),
		WidgetTools_read: () => widget,
		WidgetTools_create: () => widget,
		WidgetTools_replace: () => widget,
		WidgetTools_remove: () => undefined,
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
			respond: (_c: unknown, declared: { arms: unknown[] }, result: unknown) =>
				runtime.toolResult(declared, runtime.statusOf(declared.arms, result), result),
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
