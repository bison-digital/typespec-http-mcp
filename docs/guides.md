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

const handlers = {
	Widgets_read: (_ctx, input) => widgets.get(input.widgetId),
	Widgets_create: (_ctx, input) => save(input),
	Widgets_remove: (_ctx, input) => widgets.delete(input.widgetId),
};

const deps: ToolDeps = {
	permits: () => true,
	context: () => ({}),
	noContext: () => ({ content: [{ type: "text", text: "no caller" }], isError: true }),
	respond: (_context, declared, result) =>
		toolResult(declared, statusOf(declared.arms, result), result),
};

export default {
	fetch(request, env, ctx) {
		return createMcpHandler(() => {
			const server = new McpServer({ name: "widgets", version: "1.0.0" });
			registerTools(server, () => handlers, deps);
			return server;
		})(request, env, ctx);
	},
};
```

**Write the handler factory unannotated.** Annotating it widens the value, and the check that refuses
a handler for an operation the spec no longer declares evaporates.

An application with no result envelope of its own writes exactly the `respond` above and is finished.
One that has an envelope unwraps it there -- that is the only place it can be unwrapped, because this
emitter has no idea what a failure looks like in your application and must not invent one.

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
