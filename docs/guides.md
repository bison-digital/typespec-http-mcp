# Guides

## Adding the emitter to a project

```sh
pnpm add -D typespec-http-mcp @typespec/compiler @typespec/http
pnpm add @modelcontextprotocol/server zod
```

`typespec-http-mcp` is a **devDependency**: nothing it emits imports it. What the generated code
imports at run time is `@modelcontextprotocol/server` and `zod`, which is why those are ordinary
dependencies and declared peers here.

```yaml
# tspconfig.yaml
emit:
  - typespec-http-mcp
options:
  typespec-http-mcp:
    emitter-output-dir: "{project-root}/src/generated"
```

`tsp compile spec/main.tsp` writes three files: `schemas.gen.ts` (the validators),
`mcp-runtime.gen.ts` (the runtime contract, copied so your output imports no build-time package) and
`mcp.gen.ts` (the tool surface). **None of them is ever edited.**

## Wiring it up

You own the `McpServer`, the transport and the authentication in front of it. The generated file owns
the tool definitions and the dispatch into your handlers, and nothing else.

```ts
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { registerTools } from "./generated/mcp.gen.js";
import { toolResult, statusOf, type ToolDeps } from "./generated/mcp-runtime.gen.js";
import { handlers } from "./handlers.js"; // the same object your HTTP server gets

/**
 * The factory runs PER REQUEST and receives that request's verified identity, so `deps` is built
 * here rather than once at module scope. Built once, `permits` would close over no caller and every
 * client would see an identical tool list.
 */
const handler = createMcpHandler((context) => {
	const scopes = context.authInfo?.scopes ?? [];

	const deps: ToolDeps = {
		permits: (requirements) =>
			requirements.length === 0 ||
			requirements.some((requirement) =>
				Object.entries(requirement).every(([, needed]) =>
					needed.every((scope) => scopes.includes(scope)),
				),
			),
		context: (serverContext) => serverContext.http?.authInfo ?? null,
		noContext: () => ({ content: [{ type: "text", text: "Not authenticated." }], isError: true }),
		respond: (_serverContext, declared, result) =>
			toolResult(declared, statusOf(declared.arms, result), result),
	};

	const server = new McpServer({ name: "widgets", version: "1.0.0" });
	registerTools(server, () => handlers, deps);
	return server;
});

export default {
	fetch(request: Request): Promise<Response> {
		return handler.fetch(request);
	},
};
```

`createMcpHandler` returns an object with a `fetch` method -- **not a callable**. Calling the
returned value directly is the shape of Cloudflare's `agents` wrapper, not of this SDK, and gives
`TypeError: handler is not a function`.

`createMcpHandler` returns an object with a `fetch` method -- **not a callable**. Calling the
returned value directly is the shape of Cloudflare's `agents` wrapper, not of this SDK, and gives
`TypeError: handler is not a function`.

**Write the handler factory unannotated.** Annotating it widens the value, and the check that refuses
a handler for an operation the spec no longer declares evaporates.

An application with no result envelope of its own writes exactly the `respond` above and is finished.
One that has an envelope unwraps it there -- that is the only place it can be unwrapped, because this
emitter has no idea what a failure looks like in your application and must not invent one.

## Authenticating the server

**Everything here is the SDK's, and none of it is reimplemented by this emitter.** Verifying a
token, building the RFC 9728 discovery document, and answering a 401 with a `WWW-Authenticate`
challenge are all shipped by `@modelcontextprotocol/server`, whose `requireBearerAuth` exists
specifically for hosts whose HTTP surface is a `fetch(request)` handler.

The one thing this emitter contributes is `SCOPES_SUPPORTED` -- the union of every scope your
`@useAuth` declares -- because that is a fact only the spec knows, and RFC 9728's `scopes_supported`
is what a client reads to know which scopes to ask an Authorization Server for.

```ts
import {
	buildOAuthProtectedResourceMetadata,
	createMcpHandler,
	getOAuthProtectedResourceMetadataUrl,
	McpServer,
	oauthMetadataResponse,
	requireBearerAuth,
	type AuthInfo,
} from "@modelcontextprotocol/server";
import { registerTools, SCOPES_SUPPORTED } from "./generated/mcp.gen.js";

const resourceServerUrl = new URL("https://widgets.example.com/mcp");

const authMetadata = {
	oauthMetadata, // your Authorization Server's RFC 8414 metadata
	resourceServerUrl,
	resourceName: "Widgets",
	scopesSupported: [...SCOPES_SUPPORTED], // <- the only piece the spec owns
};

const gate = requireBearerAuth({
	verifier, // your OAuthTokenVerifier
	resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceServerUrl),
});

export default {
	async fetch(request: Request): Promise<Response> {
		// Discovery first: these are unauthenticated by definition.
		const discovery = oauthMetadataResponse(request, authMetadata);
		if (discovery !== undefined) return discovery;

		// Then the gate. It answers with the challenge Response itself when the token is missing,
		// expired, or short of a required scope -- you never construct a 401 by hand.
		const auth: AuthInfo | Response = await gate(request);
		if (auth instanceof Response) return auth;

		return handler.fetch(request, { authInfo: auth });
	},
};
```

### Reading the caller inside a tool

`handler.fetch(request, { authInfo })` is what puts the verified identity where your `ToolDeps` can
see it. **It is not populated otherwise** -- measured: without it, `context.http.authInfo` is `null`.

```ts
const deps: ToolDeps = {
	// Consulted at REGISTRATION, so a caller never sees a tool they could not call.
	permits: (requirements) =>
		requirements.length === 0 ||
		requirements.some((requirement) =>
			Object.entries(requirement).every(
				([scheme, scopes]) =>
					grant.schemes.includes(scheme) && scopes.every((s) => grant.scopes.includes(s)),
			),
		),
	context: (context) => context.http?.authInfo ?? null,
	noContext: () => ({ content: [{ type: "text", text: "Not authenticated." }], isError: true }),
	respond: (_context, declared, result) =>
		toolResult(declared, statusOf(declared.arms, result), result),
};
```

Because `permits` is consulted when the server is built, build one **per request** with that
request's grant -- which is what the stateless model does anyway.

`context.http.req` is the raw `Request` if you would rather read the header yourself, but prefer the
gate: it enforces expiry and required scopes, and produces the matching 401 or
`403 insufficient_scope` for you.

## Serving both an HTTP API and a tool surface from one implementation

Point a server emitter and this one at the same `emitter-output-dir` **with the same options**, and
pass the same handler object to both:

```yaml
emit: ["typespec-hono", "typespec-http-mcp"]
options:
  typespec-hono:
    emitter-output-dir: "{project-root}/src/generated"
    runtime-module: "../runtime.js"
  typespec-http-mcp:
    emitter-output-dir: "{project-root}/src/generated"
    runtime-module: "../runtime.js"
```

Both emitters run `typespec-http-zod`, so with identical options they write a byte-identical
`schemas.gen.ts`, and one `runtime.js` gives both surfaces one `Ctx` and one `Result<T>`.

**If the options differ, the emitters silently overwrite each other and the order of `emit:` decides
the winner.** `shared-output-dir` warns about exactly that case; see `docs/reference.md`.

## Testing a generated tool surface

Three things will cost you a confusing failure if you do not know them. Put them in one helper.

```ts
const MCP_PROTOCOL_VERSION = "2026-07-28"; // NOT LATEST_PROTOCOL_VERSION, which is stale
```

1. **`LATEST_PROTOCOL_VERSION` exported by the SDK is stale.** It reads `2025-11-25`, while the
   stateless handler accepts only `2026-07-28`. Importing the constant fails with `-32022`.
2. **`Mcp-Method` is a required header and must agree with the body**, and `Mcp-Name` is required for
   `tools/call`. Omitting either gives `-32020`.
3. **An in-process `Request` synthesises no `Host`**, and the handler answers
   `403 {"code":-32000,"message":"Missing Host header"}`. That is the DNS-rebinding check, **not** an
   authentication failure -- it costs an hour if you read it as one.

Every request also needs `_meta` carrying `io.modelcontextprotocol/protocolVersion`, `clientInfo` and
`clientCapabilities`.
