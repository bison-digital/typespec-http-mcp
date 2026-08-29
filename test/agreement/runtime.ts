import type { Env } from "hono";
import type { CallToolResult, McpServer, ServerContext } from "@modelcontextprotocol/server";

/**
 * **One runtime for BOTH generated surfaces.**
 *
 * This is the whole point of the agreement arm: the HTTP server and the tool surface are pointed at
 * the same `runtime-module`, so they share one `Ctx` and one `Result<T>`. Left at their defaults
 * each emitter would supply its own, `Result<T>` would degrade to `T`, and the compile below would
 * prove almost nothing -- an interface that most functions satisfy.
 */

export type { Awaitable, ResponseArm } from "typespec-hono/runtime";
export type { CallToolResult, McpServer, ServerContext };

import type { Awaitable } from "typespec-hono/runtime";
import type { RouteDeps as BaseRouteDeps } from "typespec-hono/runtime";
import type { SecurityRequirement, ToolResponses } from "typespec-http-mcp/runtime";

export interface AppEnv extends Env {
	readonly Bindings: { readonly SERVICE_VERSION?: string };
	readonly Variables: { readonly requestId: string };
}

/** The caller context both surfaces establish. Substituted, so it is not `unknown`. */
export interface Ctx {
	readonly subject: string;
	readonly requestId: string;
}

/** The application's envelope. Substituted, so `Result<T>` is not simply `T`. */
export type Result<T> =
	| T
	| { readonly failure: { readonly code: string; readonly detail: string } };

export type RouteDeps = BaseRouteDeps<AppEnv, Ctx>;

/** The tool-side deps, over the SAME `Ctx` and the same `Result`. */
export interface ToolDeps {
	readonly permits: (requirements: readonly SecurityRequirement[]) => boolean;
	readonly context: (context: ServerContext, authentication: "none" | "required") => Ctx | null;
	readonly noContext: (context: ServerContext) => CallToolResult;
	readonly respond: (
		context: ServerContext,
		declared: ToolResponses,
		result: unknown,
	) => Awaitable<CallToolResult>;
}
