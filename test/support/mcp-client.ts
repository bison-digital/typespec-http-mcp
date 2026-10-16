import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";

/**
 * Drive emitted tools in process through `@modelcontextprotocol/server`, as `test/acceptance` does:
 * every handler records the input it was given and answers `answer`.
 */

const MCP_PROTOCOL_VERSION = "2026-07-28";
const META = {
	"io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
	"io.modelcontextprotocol/clientInfo": { name: "fixture", version: "0" },
	"io.modelcontextprotocol/clientCapabilities": {},
};

export interface Generated {
	readonly registerTools: (
		server: McpServer,
		handlersFor: (context: unknown) => Record<string, unknown>,
		deps: Record<string, unknown>,
	) => readonly string[];
	readonly TOOL_NAMES: readonly string[];
}

export interface Client {
	/** The JSON-RPC result of one call. */
	readonly rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
	/** What the last handler to run was handed, by operation id. */
	readonly received: Map<string, unknown>;
}

export function clientFor(generated: Generated, answer: unknown): Client {
	const received = new Map<string, unknown>();
	const handlers = new Proxy(
		{},
		{
			get: (_target, name) => (_ctx: unknown, input: unknown) => {
				received.set(String(name), input);
				return answer;
			},
		},
	) as Record<string, unknown>;
	const handler = createMcpHandler(() => {
		const server = new McpServer({ name: "fixture", version: "1.0.0" });
		generated.registerTools(server, () => handlers, {
			permits: () => true,
			context: () => ({}),
			noContext: () => ({ content: [{ type: "text", text: "no caller" }], isError: true }),
		});
		return server;
	});
	const rpc = async (method: string, params: Record<string, unknown> = {}) => {
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
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: META } }),
		});
		const response = await handler.fetch(request, {
			authInfo: { token: "t", clientId: "c", scopes: [] },
		});
		return (JSON.parse(await response.text()) as { result?: unknown }).result;
	};
	return { rpc, received };
}
