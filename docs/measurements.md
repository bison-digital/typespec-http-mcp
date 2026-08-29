# Stage 0 measurements

Every fact below was produced by a probe, not recalled. Each row names the probe that produced it.
Measured against `@modelcontextprotocol/server@2.0.0` and `zod@4.5.2`, 2026-08-29.

Two results **contradicted the plan** and changed it. They are marked CONTRADICTED and the
consequence is stated.

## The protocol traps, confirmed

| trap                                            | measured                                                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `LATEST_PROTOCOL_VERSION` is stale              | exported value is `2025-11-25`; the stateless handler answers `-32022 Unsupported protocol version` and reports `supported: ["2026-07-28"]` |
| `Mcp-Method` required, must agree with the body | omitting it gives `-32020 Bad Request: the request headers and body disagree`                                                               |
| `Mcp-Name` required for `tools/call`            | as above                                                                                                                                    |
| no `Host` header                                | `403 {"code":-32000,"message":"Missing Host header"}` - reads exactly like an auth failure                                                  |

All three are owned by one helper, `test/support/mcp-client.ts`. `Mcp-Method` is derived FROM the
body there, so the two cannot disagree.

## P1 - invalid arguments **CONTRADICTED**

Called `p1` (`inputSchema: z.object({ a: z.string(), b: z.number().default(3) })`) with `{ a: 1 }`.

```
status 200 | callback ran: false
{"result":{"content":[{"type":"text","text":"Input validation error: Invalid arguments for tool p1:
  a: Invalid input: expected string, received number"}],"isError":true,...}
```

**The plan said this would be a JSON-RPC protocol error (`-32602`). It is not.** It is an ordinary
`CallToolResult` with `isError: true` at HTTP 200.

Consequences, both:

1. **The callback does not run**, so the emitter still mounts no validation and needs no `invalid`
   hook for correctness. That half of the plan stands.
2. **But the error envelope is the SDK's, not the application's.** A validation failure does not pass
   through `deps.respond`, so it does not wear the app's envelope, while every declared 4xx does.
   That inconsistency is real and must be stated in `docs/reference.md` rather than discovered.
   Whether to offer an optional `invalid` hook purely so an application can make the two uniform is
   now a genuine design question, not a correctness one - deferred, and recorded here so it is not
   silently forgotten.

## P2 - what the callback receives

Called `p1` with `{ a: "hi" }`, omitting the defaulted `b`.

```
callback received: {"a":"hi","b":3}
```

**The callback receives `z.output`** - the default is applied before dispatch. This is exactly what
the Hono handler signature already states (`z.infer` is the output side), so the two surfaces agree
about what a handler receives. Confirms the plan.

## P3 - which projection `outputSchema` publishes

`outputSchema: z.object({ x: z.string(), y: z.number().default(7) })` published:

```
outputSchema.required = ["x","y"]
```

The **output** projection, which is correct - an output schema describes what the server produces.
No pinning helper is needed. Confirms the plan.

## P4 - does `seal-object-schemas` actually reach the tool schema?

| constructor      | input `additionalProperties` | output  |
| ---------------- | ---------------------------- | ------- |
| `z.strictObject` | `false`                      | `false` |
| `z.looseObject`  | `{}`                         | `{}`    |
| `z.object`       | _(absent - silent)_          | `false` |

**`z.strictObject` does carry `additionalProperties: false` on the input projection**, so the
`seal-object-schemas` escape hatch works and the openness decision holds: publish the input
projection verbatim, and a consumer who wants sealed tool arguments sets the option that seals the
document and the validator too.

Worth recording: the library emits `looseObject`/`strictObject` for models but plain `z.object` for
parameter groups, so a merged input can mix a silent group with a loose body. The four-state
openness arm must expect that rather than treat it as a defect.

## P5 - must `structuredContent` be an object? **CONTRADICTED**

| returned                                                            | result            |
| ------------------------------------------------------------------- | ----------------- |
| `structuredContent: ["a"]` with `outputSchema: z.array(z.string())` | **200, accepted** |
| `structuredContent: "hi"` with `outputSchema: z.string()`           | **200, accepted** |
| no `outputSchema`, text only                                        | 200, accepted     |

**The plan's `no-output-schema` refusal was built on `structuredContent` having to be an object. It
does not.** The MCP specification says so too, in as many words: structured content "can be any JSON
value (object, array, string, number, boolean, or null)".

Consequence: **`no-output-schema` is deleted from the refusal set.** An operation whose success body
is an array or a scalar gets a real `outputSchema` and real `structuredContent` like any other. This
removes a refusal, a diagnostic, a documentation entry and the corpus-frequency measurement (probe 8)
that was going to decide its shape - all of which existed to work around a constraint that is not
there.

## P6 - SDK exports

Only `isCallToolResult` is a runtime value among the names of interest. `ServerContext`,
`CallToolResult`, `ToolCallback` and `RegisteredTool` are **type-only** exports, so the emitted
runtime re-exports them with `export type { ... }`. A value import would fail at run time.

## P7 - does `.shape` spread survive the projection?

Merged a `z.preprocess`-wrapped path group with a body carrying a defaulted property:

```
properties: {"widgetId":{"type":"integer",...},"name":{"type":"string"},"colour":{"default":"grey","type":"string"}}
required  : ["widgetId","name"]
```

The preprocess wrapper still projects `"type":"integer"`, and `colour` is correctly **absent** from
`required` on the input side. Merging by `.shape` spread is sound. Confirms the plan.

## P-void - is `{ content: [] }` valid?

`200`, accepted, echoed back as `{"content":[],"resultType":"complete",...}`. A `void`/204 operation
can return it without inventing a sentence. Probe 9 (how a real _client_ handles it) is **closed**:
`test/socket/socket.test.ts` calls a `void` operation through `@modelcontextprotocol/client` over a
socket, and the client reports `content: []` with no error. A bodyless success needs no invented
sentence at either end.

## Still open

| probe                                  | why it is deferred                         |
| -------------------------------------- | ------------------------------------------ |
| 8 - `no-output-schema` frequency       | **moot**; the refusal was deleted by P5    |
| 9 - `{ content: [] }` client rendering | **closed** by `test/socket/socket.test.ts` |

## Tier 2, measured

The socket arm, and the numbers it moved.

| measurement                                | value                                                                        |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| corpus scenarios / emitted files compiling | **65 / 65**, with no exceptions list. Was 65 / 64                            |
| defects pinned as upstream                 | **0**. Was 1                                                                 |
| `pnpm test`                                | 24 files, 189 tests                                                          |
| `pnpm test:unit` against `pnpm test`       | **5s against 42s** -- the reason the suite is split into two vitest projects |

**A Node builtin in `src/runtime.ts` is invisible to `architecture.test.ts` and fatal on workerd.**
`node:fs` planted there left all ten architecture arms green and failed five socket arms with
`Uncaught Error: No such module "node:fs"`. The closure that grades imports skips every `node:`
specifier, so `emitter.ts` may read the filesystem -- correct for every module except the one copied
verbatim into a consumer's build. There is now an arm for it, red on the same plant.

**Three controls on the socket arm, each proven red and restored from a byte copy.**

| plant                                       | result                                                   |
| ------------------------------------------- | -------------------------------------------------------- |
| `deps` hoisted to module scope              | 2 arms red -- all three callers see one list             |
| `handler(request)` instead of `.fetch(...)` | 4 arms red -- `TypeError: handler is not a function`     |
| `node:fs` in the copied runtime             | 5 arms red -- `Uncaught Error: No such module "node:fs"` |

## Reserved words, re-measured (in `typespec-http-zod`)

`tsc` 7.0.2, **one invocation per word**, both declaration positions, over 56 candidates drawn from
this package's own list and from `@typespec/http-specs`.

| result                     | value                                                                   |
| -------------------------- | ----------------------------------------------------------------------- |
| refused in either position | **39**                                                                  |
| listed before this work    | 37 -- `as` and `yield` were missing                                     |
| listed and NOT refused     | **0**; the set is exact, not over-broad                                 |
| `as`                       | legal as an `interface` name, `TS1005` as a type alias                  |
| `yield`                    | `TS1214` in both, and recorded in the list's docblock as measured-legal |

**A single `tsc` run over all 112 probe files reported a capped subset**, ending alphabetically at
`t_with.ts` and silently omitting `t_yield.ts`. The first measurement here concluded `as` was the
only miss because of it. One invocation per word is the form that answers.
