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
import { McpServer, createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";
import { registerTools } from "./generated/mcp.gen.js";
import type { ToolDeps } from "./generated/mcp-runtime.gen.js";
import { handlers } from "./handlers.js"; // the same object your HTTP server gets

/**
 * The factory runs PER REQUEST and receives that request's verified identity, so `deps` is built
 * here rather than once at module scope. Built once, `permits` would close over no caller and every
 * client would see an identical tool list.
 */
const handler = createMcpHandler((context) => {
	const scopes = context.authInfo?.scopes ?? [];

	const deps: ToolDeps<AuthInfo> = {
		permits: (requirements) =>
			requirements.length === 0 ||
			requirements.some((requirement) =>
				Object.entries(requirement).every(([, needed]) =>
					needed.every((scope) => scopes.includes(scope)),
				),
			),
		context: (serverContext) => serverContext.http?.authInfo ?? null,
		noContext: () => ({ content: [{ type: "text", text: "Not authenticated." }], isError: true }),
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

`ToolDeps<AuthInfo>` says what `context` returns, and `registerTools` infers the caller every handler
receives from it. A handler returns `{ status, body, headers }` for a response the document declares;
see [What a handler returns](../README.md#what-a-handler-returns). There is no hook turning a result
into a tool result: the generated callback hands the handler's result to `toolResult`, which serves
it by the rules the document and the MCP specification state.

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
const deps: ToolDeps<AuthInfo> = {
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
  typespec-http-mcp:
    emitter-output-dir: "{project-root}/src/generated"
```

Both emitters run `typespec-http-zod`, so with identical options they write a byte-identical
`schemas.gen.ts`, which imports nothing but Zod. Each writes its own runtime beside it,
`runtime.gen.ts` and `mcp-runtime.gen.ts`, and neither is replaced.

The two surfaces type a handler identically: the same input, the same caller context, and the same
`{ status, body, headers }` union for each operation. So one object serves both:

```ts
import { registerRoutes, type Operations } from "./generated/app.gen.js";
import { registerTools } from "./generated/mcp.gen.js";

const operations = {
	WidgetTools_read: (caller: Caller, input) => ({ status: 200, body: widgets.get(input.widgetId) }),
	// ...every operation the document declares
} satisfies Operations<Caller>;

registerRoutes(app, () => operations, routeDeps); // routeDeps: RouteDeps<AppEnv, Caller>
registerTools(server, () => operations, toolDeps); // toolDeps: ToolDeps<Caller>
```

`satisfies Operations<Caller>` rather than `Tools<Caller>`, because a tool set may be a subset of the
operations and `satisfies` refuses a key its target does not name. Both registration calls still
refuse a handler for an operation the document no longer declares. `test/agreement/` compiles an
object like this one through both surfaces and holds every operation's signature identical.

**If the options differ, the emitters silently overwrite each other and the order of `emit:` decides
the winner.** `shared-output-dir` warns about exactly that case; see `docs/reference.md`.

## Running long tools as MCP tasks

A tool whose work outlives a request can answer a client that supports the
[MCP Tasks extension](https://github.com/modelcontextprotocol/ext-tasks) with a task handle at once.
The client polls `tasks/get` for the result, answers `tasks/update` when the task asks for input, and
stops it with `tasks/cancel`.

Nothing in the spec changes. Three things are added where you wire the tools:

1. **A store**, implementing the runtime's `TaskStore`: where tasks live and how their work is found.
2. **The extension**, `new TasksExtension(store)`, attached to each server before it connects. It
   serves the capability and the three `tasks/*` methods.
3. **A policy**, `deps.tasks`: which operations may answer with a task, and how one is created.

```ts
import { McpServer, createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";
import { registerTools, type ToolCall } from "./generated/mcp.gen.js";
import { TasksExtension, type ToolDeps } from "./generated/mcp-runtime.gen.js";
import { handlers } from "./handlers.js";
import { store } from "./tasks.js"; // your TaskStore

/** One extension for the deployment: the factory below builds a server per request. */
const tasks = new TasksExtension(store);

const handler = createMcpHandler((context) => {
	const deps: ToolDeps<AuthInfo, ToolCall> = {
		permits: () => true,
		context: (serverContext) => serverContext.http?.authInfo ?? null,
		noContext: () => ({ content: [{ type: "text", text: "Not authenticated." }], isError: true }),
		tasks: {
			operations: ["exportCatalog"],
			// Optional: answer at once when there is nothing to wait for.
			decide: (call) => (call.operationId === "exportCatalog" ? "task" : "inline"),
			create: (call, caller, serverContext) =>
				tasks.create(serverContext, { context: { call, caller: caller.clientId } }),
		},
	};

	const server = new McpServer({ name: "bookshop", version: "1.0.0" });
	tasks.attach(server);
	registerTools(server, () => handlers, deps);
	return server;
});
```

**`ToolDeps<AuthInfo, ToolCall>`, with the generated `ToolCall`**, is what types the policy:
`operations` accepts only this service's operations, and `decide` and `create` receive the call with
its validated input. `ToolDeps<AuthInfo>` admits no operation.

**`create` chooses what the store keeps.** `call` is plain JSON, the operation and its input. The
caller is yours to reduce to what your work needs to rebuild it, because a task's work runs later,
somewhere the request's context is gone.

**The work runs the same handler through `runTool`:**

```ts
import { runTool } from "./generated/mcp.gen.js";

const result = await runTool(handlers, call, caller); // a CallToolResult; it never throws
```

It answers what a listed tool answers, through the same declared responses. A declared failure, a
result the document does not declare and a thrown error all answer the tool error the blocking call
answers, so the task completes with `isError`, as the extension requires. Mark a task `failed` only
when the work fails below the tool, with a JSON-RPC error. `runTool` itself throws for two such faults, without calling the handler: a call naming an operation this service has no tool for, which a store shared by several services can hand it, and a call whose stored input the tool's argument schema no longer accepts, which a task that outlived a deploy can.

`registerTools` throws when `deps.tasks` lists an operation and no `TasksExtension` is attached to the
server: its tasks could not be polled. Attach first.

### A store on Cloudflare Workflows

A Workflow is close to a task already: an instance with an id you choose, a status, an output, a
way to stop it and a way to send it an event.

| store method | Workflow                                                                 |
| ------------ | ------------------------------------------------------------------------ |
| `create`     | `env.WORK.create({ id: crypto.randomUUID(), params })`                   |
| `get`        | `(await env.WORK.get(taskId)).status()`                                  |
| `update`     | `instance.sendEvent({ type, payload })`, received by `step.waitForEvent` |
| `cancel`     | `instance.terminate()`                                                   |

The Workflow's `run` calls `runTool` and returns its result, which `status()` then reports as
`output`. Map `complete` to `completed` with that output as the `result`, `errored` to `failed` with
a `-32603` error, `terminated` to `cancelled`, and every other status to `working`. What the
mapping does not give you, per the
[Workflows Workers API](https://developers.cloudflare.com/workflows/build/workers-api/):

- **Unknown ids.** `get` throws for an instance id that does not exist; the store answers
  `undefined`, which the extension answers as "Task not found".
- **The principal and the creation time.** `status()` does not return an instance's params, so keep
  them where `get` can check them, a KV namespace or a D1 row, written before `create` resolves.
- **Idempotent cancellation.** `terminate()` throws on an instance that is errored, terminated or
  complete, and the extension requires cancelling a finished task to succeed, so treat that as done.
- **Outstanding input.** A Workflow waiting on `step.waitForEvent` reports `waiting`, not what it is
  waiting for. Record the `inputRequests` a task has asked, and report `input_required` with them.
- **Retention.** Give the instance at least the task's `ttlMs`.

### What a task does not do

- **A client that did not declare the extension is answered inline**, as if no policy were set. The
  extension also allows refusing it with `-32021`, but thrown from a tool, the SDK this package
  supports answers `-32021` as a tool error instead, so that answer waits for an SDK that passes it
  through. Do not list an operation that cannot run inline.
- **Tasks are polled.** `notifications/tasks` is not served.

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

## Upgrading

### To `0.9.0`

`0.9.0` requires `@modelcontextprotocol/server` `^2.3.0`, the first release that routes `tasks/get`
to a registered handler. Nothing else is required of you: wiring written for `0.8` compiles and
behaves as it did, `ToolDeps<Caller>` included. Regenerated output differs: `mcp.gen.ts` gains
`ToolCall` and `runTool` and a branch in each tool for a task, and the runtime gains the Tasks
extension. None of it runs until you set `deps.tasks`; see
[Running long tools as MCP tasks](#running-long-tools-as-mcp-tasks).

### To `0.7.0`

`0.7.0` requires `typespec-http-zod` `0.33.0`, which only adds to its API, and pairs with
`typespec-hono` `0.30.0`. The generated tool surface is unchanged. Take it with any emitter built on
`typespec-http-zod` `0.33.0`, so the project loads one copy of the library.

### To `0.6.0`

`0.6.0` requires `typespec-http-zod` `0.32.0` and pairs with `typespec-hono` `0.29.0`. Read the
library's "To `0.32.0`" and "OpenAPI versions" sections. For a tool surface:

- **The OpenAPI version openapi3 publishes decides how a tool's arguments are read.** Unset, it is
  `3.0.0`, and a create tool may be called without its server-assigned read-only `id`; its
  `inputSchema` does not require it. Set to `3.1.0`, it is required.
- **A 3.0 compile can now refuse a `null` its document cannot say.** `openapi-versions: ["3.1.0"]`
  under `@typespec/openapi3` in `tspconfig.yaml` is the fix.

### To `0.5.0`

`0.5.0` requires `typespec-http-zod` `0.31.0` and pairs with `typespec-hono` `0.28.0`; `0.4.0`'s range,
`^0.30.0`, cannot reach that library, which is why this is a release rather than a lockfile bump. Read
the library's "To `0.31.0`" section. For a tool surface:

- **A discriminated base admits any value its base does.** An argument naming a subtype that is not a
  valid instance of it is accepted as the base, as the document's base accepts it, so a handler
  narrowing on `kind` no longer gets the subtype. Narrow on a property the subtype declares.
- **A request body declared `never` refuses the compile** as `never-body`. Declare `void` for no body;
  that operation is still a tool.
- **The library's declarations are named as the document names them**, so a consumer importing its
  schemas by name renames what `tsc` reports missing.

### To `0.4.0`

`0.4.0` requires `typespec-http-zod` `0.30.0` and pairs with `typespec-hono` `0.27.0`; `0.3.0`'s range,
`^0.29.0`, cannot reach that library, which is why this is a release rather than a lockfile bump. Read
the library's "To `0.30.0`" section. For a tool surface:

- **A discriminated base admits a value naming no subtype, as the base.** An argument with an unknown
  `kind` is no longer refused. A handler narrowing on `kind` handles the base in the `default`.
- **An operation two of whose inputs share one key is not a tool.** `shared-input-key` names it, the
  key and both locations; rename one and the tool comes back.
- **An operation whose request body is declared `void` or `never` is a tool**, where it was refused as
  `non-object-body`.

### To `0.3.0`

`0.3.0` requires `typespec-http-zod` `0.29.0` and pairs with `typespec-hono` `0.26.0`; compile both
into one directory only at versions that pair. Read the library's "To `0.29.0`" section: three of its
changes make a tool refuse arguments it accepted, and in each the published document already refused
them - a date-time header with no `@encode` is an HTTP-date, a scalar extending a constrained one is
constrained by both, and `@encode(rfc3339)` on a date-time checks it.

**Every argument in `tools/list` carries the description its spec gives it**: a parameter's
`@param` text, a property's doc, a declared scalar's doc where the property has none. Nothing to
change; a model calling the tool now reads what each field is for.

**A path parameter decoded out of its URI segment takes its value as a tool argument.** For
`{.param}`, `{;param}` or a segment with a literal around the expression, a tool validated the
argument as the segment's text, so `{ param: "a" }` was refused, and a value starting with the
route's literal was rewritten. A caller that worked around it by sending the segment text now sends
the value, as `tools/list` always said.

### Coming from `0.1.0`

Read [To `0.2.0`](#to-020) as well: its changes apply in full, and the library's "To `0.27.0`" and
"To `0.28.0`" sections with it.

### To `0.2.0`

`0.2.0` requires `typespec-http-zod` `0.28.0` and pairs with `typespec-hono` `0.25.0`. `0.1.0` was
built on the library's `0.26.0`, so both of the library's later upgrades apply to the validators a
tool checks its arguments with: read its "To `0.27.0`" and "To `0.28.0`" sections. Two of them
change what a caller of a tool sees: an integer outside its declared width (`int32`) is refused, and
a `@pattern` is matched with the Unicode flag.

**A tool's types follow the server's handler, which one handler object serves.**

- A result body is typed from the schema's input, so a defaulted property may be left out; an optional
  one is `?: T`, with no `| undefined`.
- An optional request body is `body?: T`, absent when the call leaves it out, and the tool's argument
  schema lets the call leave it out. It was required.
- A binary result is `ByteStream | Uint8Array<ArrayBuffer> | ArrayBuffer`. A platform stream still
  satisfies `ByteStream`, so a handler returning one compiles as before.
- An input made only of an empty model is `{}`.
- On a route several operations share, a tool hands its handler that operation's `accept` literal.
- A cookie parameter is an argument, as a header is.
- A response header declared with `@encode` is its encoded type: `number` for
  `@encode(DurationKnownEncoding.seconds, int32)`.

**Bytes under any media type are a tool result.** Under an image or audio type they are that block,
as before; under any other, such as `application/pdf` or `application/octet-stream`, an embedded
resource, `{ type: "resource", resource: { uri, mimeType, blob } }`, where `0.1.0` refused the
operation with `binary-tool-output`. That diagnostic is gone, and those operations join `TOOL_NAMES`
and `Tools`: a handler object written to `satisfies Tools` needs a handler for each; one written to
`satisfies Operations` and passed to `registerTools` already has one.

**An `Http.File` upload is not a tool**, and is refused with `binary-tool-input`, where `0.1.0`
published it as a tool that dropped the file. A download is a tool under any media type, as bytes
are. A model under a media type that is neither JSON nor text is bytes too, in both directions.

**Each operation on a shared route is described and selected as itself**, so its tool may gain the
description it always declared, and `tool-tags` may now select or exclude it on its own tags.

### From `runtime-module` and `deps.respond`

**`runtime-module` is refused with `runtime-module-removed`, an error.** `mcp-runtime.gen.ts` is
written on every compile and the generated file always imports it. A module the option pointed at can
be deleted; what it declared has a place of its own:

| a substituted module declared, or a `respond` did | now                                                                  |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| `Ctx`                                             | inferred by `registerTools` from what `deps.context` returns         |
| `Result<T>`                                       | the union of the responses the document declares, `{ status, body }` |
| `statusOf(declared.arms, result)`                 | the handler returns `status`                                         |
| a failure thrown, or mapped to an envelope        | the handler returns the declared failure response                    |
| checking the body against `arm.schema`            | done by `toolResult`, for failures too, as `ResponseContractError`   |
| response headers read off the result              | the handler returns `headers`, keyed by wire name                    |
| `when` on an arm, choosing between two successes  | the handler returns the status it means                              |

**A handler returns `{ status, body }`.**

```ts
// before
WidgetTools_read: (ctx, input) => widgets.get(input.widgetId),
// after
WidgetTools_read: (caller, input) => ({ status: 200, body: widgets.get(input.widgetId) }),
```

**`deps` loses `respond`**, and `ToolDeps` takes the caller type: `ToolDeps<Caller>`.

A thrown `ResponseContractError` or `UndeclaredStatusError` reaches the SDK, which answers the call
as a tool-execution error. An application that wants a different answer catches them in its
handlers' adapter.
