/**
 * **The wiring `docs/guides.md` documents, as a Worker, so the documentation is graded by running.**
 *
 * Every other arm in this package runs in Node against a `Request` this repository constructed. This
 * file is bundled by esbuild, served by workerd, and driven by the official MCP client over a real
 * socket -- which is the only place four things can be checked at all: that emitted output survives
 * bundling, that it runs on the runtime it is written for, that the protocol headers a real client
 * writes are the ones the surface expects, and that ONE server answers different callers
 * differently.
 *
 * Excluded from `pnpm typecheck` by `tsconfig.json` (`**\/*.fixture.ts`): it imports from a
 * gitignored output directory, so checking it there would make a fresh clone fail before its first
 * build. `socket.test.ts` compiles it against freshly emitted output instead.
 */
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { registerTools, type Tools } from "./.out/socket/mcp.gen.js";
import type { ToolDeps } from "./.out/socket/mcp-runtime.gen.js";

/**
 * The same handler object an HTTP server would be given. **`satisfies`, not an annotation**, so each
 * `status` stays the literal that selects its response and `registerTools` still sees every key.
 */
const widget = { id: "1", name: "a", colour: "grey" };
const handlers = {
	health: () => ({ status: 200, body: { status: "ok" } }),
	WidgetTools_list: () => ({ status: 200, body: { items: [widget], total: 1 } }),
	WidgetTools_read: (_ctx, input) =>
		input.widgetId === "missing"
			? { status: 404, body: { code: "missing", message: "No widget has that identifier." } }
			: { status: 200, body: widget },
	WidgetTools_create: () => ({ status: 200, body: widget }),
	WidgetTools_remove: () => ({ status: 204 }),
} satisfies Tools;

/**
 * Three callers, one deployment.
 *
 * **This is the shape the in-process arm cannot have.** `acceptance.test.ts` builds a NEW handler
 * per RPC, closing over the grant, so it cannot tell a per-request `deps` from a per-handler one --
 * the trap it is credited with catching. Here the handler is built once, at module scope, and the
 * grant arrives only on the request.
 */
const GRANTS: Record<string, { schemes: readonly string[]; scopes: readonly string[] }> = {
	"reader-token": { schemes: ["OAuth2Auth"], scopes: ["widgets.read"] },
	"writer-token": { schemes: ["OAuth2Auth"], scopes: ["widgets.read", "widgets.write"] },
	"nobody-token": { schemes: [], scopes: [] },
};
const NO_GRANT = { schemes: [], scopes: [] } as const;

/**
 * **The factory runs PER REQUEST and receives that request's verified identity**, so `deps` is built
 * here rather than once at module scope. Built once, `permits` would close over no caller and every
 * client would see an identical tool list.
 */
const handler = createMcpHandler(
	(context: { authInfo?: { scopes?: string[]; extra?: Record<string, unknown> } }) => {
		const scopes = context.authInfo?.scopes ?? [];
		const schemes = (context.authInfo?.extra?.["schemes"] as readonly string[] | undefined) ?? [];

		const deps: ToolDeps = {
			permits: (requirements) =>
				requirements.length === 0 ||
				requirements.some((requirement) =>
					Object.entries(requirement).every(
						([scheme, needed]) =>
							schemes.includes(scheme) && needed.every((scope) => scopes.includes(scope)),
					),
				),
			context: () => ({}),
			noContext: () => ({ content: [{ type: "text", text: "Not authenticated." }], isError: true }),
		};

		const server = new McpServer({ name: "widgets", version: "1.0.0" });
		registerTools(server, () => handlers, deps);
		return server;
	},
);

/**
 * `createMcpHandler` returns an OBJECT with a `fetch` method, not a callable. Calling the returned
 * value directly is the shape of Cloudflare's `agents` wrapper and gives
 * `TypeError: handler is not a function`.
 */
export default {
	fetch(request: Request): Promise<Response> {
		const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
		const grant = GRANTS[token] ?? NO_GRANT;
		return handler.fetch(request, {
			authInfo: {
				token,
				clientId: "socket",
				scopes: [...grant.scopes],
				extra: { schemes: [...grant.schemes] },
			},
		});
	},
};
