# typespec-http-mcp

A TypeSpec emitter that generates an **MCP tool surface** from an HTTP service definition, and the
Zod validators it publishes.

The generated code dispatches into **the same handler object** a generated HTTP server calls, so one
implementation serves both surfaces and neither is written twice.

```yaml
# tspconfig.yaml
emit:
  - typespec-http-mcp
options:
  typespec-http-mcp:
    emitter-output-dir: "{project-root}/src/generated"
```

Install it as a **devDependency**: nothing it emits imports it.

```sh
pnpm add -D typespec-http-mcp
pnpm add @modelcontextprotocol/server zod
```

## What it emits, and what you write

The generated file is **never edited, only called**. You own the `McpServer`, the transport and the
authentication in front of it:

```ts
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { registerTools } from "./generated/mcp.gen.js";
import { handlers } from "./handlers.js"; // the same object your HTTP server gets
import { toolDeps } from "./deps.js";

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		return createMcpHandler(() => {
			const server = new McpServer({ name: "widgets", version: "1.0.0" });
			registerTools(server, () => handlers, toolDeps);
			return server;
		})(request, env, ctx);
	},
};
```

Write the handler factory **unannotated**. Annotating it widens the value and disables the check that
refuses a handler for an operation the spec no longer declares.

## What is derived, and from what

Nothing is invented. Every field of a tool comes from something the document already states, or from
a published specification:

| tool field                   | derived from                                         |
| ---------------------------- | ---------------------------------------------------- |
| `name`                       | the operation id the document publishes              |
| `title`                      | `@summary`                                           |
| `description`                | `@doc`                                               |
| `inputSchema`                | the emitted Zod schema, **input** projection         |
| `outputSchema`               | the success response body                            |
| `annotations.readOnlyHint`   | the method's safety, per IANA's HTTP Method Registry |
| `annotations.idempotentHint` | the method's idempotence, same source                |
| which operations are tools   | `@tag`, which `@typespec/openapi3` publishes         |

There are **no decorators**. A decorator would let a spec state something the OpenAPI document
cannot publish, so the emitted surface would enforce a rule no reader of the contract can see.

## Documentation

- [`docs/reference.md`](docs/reference.md) -- every option and every diagnostic.
- [`docs/architecture.md`](docs/architecture.md) -- what each module owns, and the boundaries that are enforced.
- [`docs/oracles.md`](docs/oracles.md) -- what each emitted artefact is compared against.
- [`docs/guides.md`](docs/guides.md) -- wiring it up, serving both surfaces, and testing one.
- [`docs/releasing.md`](docs/releasing.md) -- the local-registry rehearsal and the proof this package passed.
- [`docs/measurements.md`](docs/measurements.md) -- the probes the design rests on.

## Licence

MIT.
