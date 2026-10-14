import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { compile, NodeHost } from "@typespec/compiler";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * **A tool hands its handler the value the REST route hands it, for every request the corpus
 * declares.**
 *
 * One handler object serves `registerRoutes` and `registerTools`, so a tool given what a route
 * handed the handler must hand over the same thing. For a path parameter the library decodes out of
 * its URI segment - `{.param}`, `{;param}`, a segment with a literal around the expression - the
 * tool validated the argument as the segment's TEXT: `{ param: "a" }` was refused for
 * `primitive{.param}`, and `"primitivex"` was rewritten to `"x"` (issue #1). Six
 * `@typespec/http-specs` path scenarios failed. The type-level agreement suite passed throughout,
 * because it compares types and never parses a tool's arguments.
 *
 * **Every request is the mock's**, sent to the generated Hono app unchanged; whatever reached the
 * handler is then the tool call's arguments, through an MCP request the SDK handles as a client's.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const specs = join(packageRoot, "node_modules", "@typespec", "http-specs", "specs");
const MCP_PROTOCOL_VERSION = "2026-07-28";

interface Received {
	readonly operation: string;
	readonly input: Record<string, unknown>;
}

let received: Received | undefined;

/** One handler object for both surfaces, answering 204 and recording what it was given. */
const handlers = new Proxy(
	{},
	{
		get: (_target, operation) => (_ctx: unknown, input: Record<string, unknown>) => {
			received = { operation: String(operation), input };
			return { status: 204 };
		},
	},
);

let rest: (uri: string) => Promise<Received | undefined>;
let tool: (name: string, args: Record<string, unknown>) => Promise<Received | undefined>;
let uris: readonly (readonly [string, string])[];

beforeAll(async () => {
	const outDir = join(here, ".out-pathvalues");
	rmSync(outDir, { recursive: true, force: true });
	const options = { "emitter-output-dir": outDir, "seal-object-schemas": true };
	const program = await compile(NodeHost, join(specs, "routes", "main.tsp"), {
		outputDir: outDir,
		emit: ["typespec-hono", "typespec-http-mcp"],
		options: { "typespec-hono": options, "typespec-http-mcp": options },
	});
	expect(program.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

	const server = (await import(join(outDir, "app.gen.ts"))) as {
		registerRoutes: (app: unknown, handlersFor: unknown, deps: unknown) => void;
	};
	const app = new Hono();
	type Context = { json: (body: unknown, status: number) => Response };
	server.registerRoutes(app, () => handlers, {
		authorize: () => async (_c: Context, next: () => Promise<void>) => {
			await next();
			return undefined;
		},
		context: () => ({}),
		noContext: (c: Context) => c.json({}, 401),
		notAcceptable: (c: Context) => c.json({}, 406),
		invalid: (result: { success: boolean }, c: Context) =>
			result.success ? undefined : c.json({}, 400),
	});
	rest = async (uri) => {
		received = undefined;
		await app.request(uri);
		return received;
	};

	const tools = (await import(join(outDir, "mcp.gen.ts"))) as {
		registerTools: (server: McpServer, handlersFor: unknown, deps: unknown) => readonly string[];
	};
	const mcp = createMcpHandler(() => {
		const server = new McpServer({ name: "routes", version: "1.0.0" });
		tools.registerTools(server, () => handlers, {
			permits: () => true,
			context: () => ({}),
			noContext: () => ({ content: [{ type: "text", text: "no caller" }], isError: true }),
		});
		return server;
	});
	tool = async (name, args) => {
		received = undefined;
		const request = new Request("https://example.test/mcp", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				host: "example.test",
				"mcp-protocol-version": MCP_PROTOCOL_VERSION,
				"mcp-method": "tools/call",
				"mcp-name": name,
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name,
					arguments: args,
					_meta: {
						"io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
						"io.modelcontextprotocol/clientInfo": { name: "pathvalues", version: "0" },
						"io.modelcontextprotocol/clientCapabilities": {},
					},
				},
			}),
		});
		await (
			await mcp.fetch(request, { authInfo: { token: "t", clientId: "c", scopes: [] } })
		).text();
		return received;
	};

	const mock = readFileSync(join(specs, "routes", "mockapi.ts"), "utf8");
	uris = [...mock.matchAll(/Scenarios\.(\w+) = createTests\(\s*"([^"]+)"/g)].map(
		([, scenario, uri]) => [scenario ?? "", uri ?? ""] as const,
	);
}, 300_000);

describe("http-specs routes: a tool agrees with the REST route on every mock request", () => {
	it("sends every request the mock declares", () => {
		expect(uris).toHaveLength(50);
	});

	it("hands the handler, through the tool, exactly what the route handed it", async () => {
		const disagreements: string[] = [];
		let compared = 0;
		let decodedPaths = 0;
		for (const [scenario, uri] of uris) {
			const viaRoute = await rest(uri);
			if (viaRoute === undefined) {
				disagreements.push(`${scenario}: the route reached no handler`);
				continue;
			}
			const viaTool = await tool(viaRoute.operation, viaRoute.input);
			compared++;
			if (/_(?:Label|Matrix|Simple)Expansion_/.test(scenario)) decodedPaths++;
			if (JSON.stringify(viaTool) !== JSON.stringify(viaRoute)) {
				disagreements.push(
					`${scenario}: route ${JSON.stringify(viaRoute.input)} tool ${JSON.stringify(viaTool?.input ?? "REFUSED")}`,
				);
			}
		}
		expect(disagreements).toEqual([]);
		expect(compared).toBe(50);
		// The scenarios issue #1 was found on, and the arrays and records beside them.
		expect(decodedPaths).toBeGreaterThanOrEqual(18);
	}, 300_000);

	it("passes a value that starts with the route's literal through unchanged", async () => {
		// `primitive{param}`: the decoder strips the literal, so `primitivex` became `x`.
		const [, uri = ""] =
			uris.find(
				([scenario]) => scenario === "Routes_PathParameters_SimpleExpansion_Standard_primitive",
			) ?? [];
		const operation = (await rest(uri))?.operation ?? "";
		expect(operation).not.toBe("");
		expect(await tool(operation, { param: "primitivex" })).toEqual({
			operation,
			input: { param: "primitivex" },
		});
	});
});
