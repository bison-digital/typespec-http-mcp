# Reference

Every option this emitter accepts and every diagnostic it can raise.
`test/documentation.test.ts` grades this file against `$lib` in both directions, so an option or a
diagnostic that exists and is not here fails the suite, and so does one written here that does not
exist.

## Options

This emitter runs the whole of `typespec-http-zod`, so **every option that library accepts also
reaches it**, derived from its published schema rather than restated. Those are documented in that
package; they are listed here because this file is graded as a class.

| option                       | default | what it does                                                                           |
| ---------------------------- | ------- | -------------------------------------------------------------------------------------- |
| `contracts-output-dir`       | unset   | Forwarded to the library.                                                              |
| `contracts-package`          | unset   | Forwarded to the library.                                                              |
| `seal-object-schemas`        | `false` | Forwarded to the library. **It also decides the tool surface**: see _Openness_ below.  |
| `compile-schemas`            | unset   | Forwarded to the library.                                                              |
| `key-vocabularies`           | unset   | Forwarded to the library.                                                              |
| `runtime-module`             | refused | Refused with `runtime-module-removed`. `mcp-runtime.gen.ts` is always emitted.         |
| `regenerate-hint`            | unset   | The command named in the generated banner.                                             |
| `services`                   | unset   | Per-service overrides. Every option above may be set per service, plus the four below. |
| `tool-tags`                  | unset   | Tags that mark an operation as a tool. **Unset means every operation is one.**         |
| `exclude-tags`               | `[]`    | Tags that exclude an operation, even when `tool-tags` selected it.                     |
| `tool-prefix`                | unset   | Prepended to every tool name, verbatim.                                                |
| `services.<name>.emit-tools` | `true`  | Set `false` for a service that is in the program only for its types.                   |

### `tool-tags`, and why the default is "everything"

An operation is a tool when `getAllTags` reports a tag in `tool-tags`. **Union, not intersection**:
OpenAPI tags are a flat set with no AND semantics, so "carries any of these" is the only reading the
published document supports.

Tags are read with `getAllTags`, so a `@tag` on an **interface** or on the **service namespace**
reaches the operations inside it. That is the point -- tagging an interface is how a group of
operations is marked -- but note the consequence: a `@tag` on the service namespace selects
everything, so a tag used for grouping and a tag used for selection should not be the same word.

The default is every operation rather than a magic tag name, because a magic name is a rule an author
cannot see in the document and cannot discover, and it makes a correctly configured emitter produce
nothing at all.

### `runtime-module`

**Refused with `runtime-module-removed`, an error.** It used to replace `mcp-runtime.gen.ts` with an
application's own module, which made the application own a copy of arm selection and the tool-result
rules. The option is still in the schema so that setting it reports what to do instead, rather than
"must NOT have additional properties". The generated file always imports `./mcp-runtime.gen.js`. See
[Upgrading](guides.md#upgrading).

The runtime is `mcp-runtime.gen.ts`, **not** `runtime.gen.ts`. If you also emit a server from the
same spec into the same directory, the two emitters would otherwise both claim `runtime.gen.ts`.
`emitFile` has no duplicate-path detection, so that is a silent last-writer-wins decided by the order
of `emit:` in `tspconfig.yaml`. With distinct runtime filenames the only file the two can contest is
`schemas.gen.ts`, which imports no runtime and is byte-identical under identical options.

## What a tool answers

A handler returns `{ status, body, headers }` for a response the document declares, and the
generated callback hands it to `toolResult`:

| the result                                               | the tool result                                                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| a status no declared response governs                    | throws `UndeclaredStatusError`                                                                       |
| a media type the status does not offer                   | throws `UndeclaredStatusError`; a range such as `image/*` admits its types                           |
| a JSON body its status's schema refuses                  | throws `ResponseContractError`, with Zod's issues                                                    |
| a JSON body its status's schema accepts                  | the PARSED body, as a `text` block of JSON                                                           |
| a string body under a media type that is not JSON        | parsed against its schema, and the parsed string as a `text` block                                   |
| bytes under an `image/*` media type                      | an `image` block: `{ type: "image", data: <base64>, mimeType }`                                      |
| bytes under an `audio/*` media type                      | an `audio` block: `{ type: "audio", data: <base64>, mimeType }`                                      |
| a model under a media type that is not JSON              | the text the handler supplied, unvalidated; anything but a string throws                             |
| a response with no body                                  | `content: []`                                                                                        |
| a 4xx or 5xx status                                      | `isError: true`                                                                                      |
| a body whose schema is the `outputSchema`                | the parsed body as `structuredContent` too                                                           |
| a 2xx or 3xx through another arm, with an `outputSchema` | checked against the `outputSchema`: `structuredContent` if it passes, `ResponseContractError` if not |
| declared response headers                                | `_meta["typespec-http-mcp/response-headers"]`, keyed by wire name                                    |

A binary body may be a `Uint8Array`, an `ArrayBuffer` or a `ReadableStream`; a stream is read to its
end, because a tool result is one message. `mimeType` is the media type served: the handler's
`contentType` where the status offers several or a range, otherwise the one it offers.

The runtime cannot tell a string, bytes and a serialised model apart from an arm, so the generated
call passes `bodies` beside the arms, keyed by status, only for the statuses that answer text or
bytes: `{ arms: pictureResponses, outputSchema: undefined, bodies: { "200": "binary" } }`.

A thrown error reaches the SDK, which answers the call as a tool-execution error carrying its message.

**`outputSchema` is the body of the lowest exact 2xx or 3xx status, published only where every 2xx
and 3xx response the operation declares answers with that same body, as JSON.** The SDK refuses a
result that is not an error and carries no `structuredContent` once a tool declares an
`outputSchema`: the server answers "Output validation error", and `@modelcontextprotocol/client`
throws. An operation answering `201` with one body and `200` with another, or `204` with none,
therefore publishes no `outputSchema`, and every one of its successes reaches the caller as text.

A `default` response is not a success the document names, so it does not stop the common
`Widget | Problem` shape publishing its schema. It does govern the 2xx and 3xx statuses nobody
listed, so a success answered through it must meet the published schema as well as its own: the
handler's body is checked against the `outputSchema`, and a body that fails is a
`ResponseContractError` naming the operation rather than the SDK's "no structured content".

## What cannot be a tool

An operation is refused, and left out of `Tools` and `TOOL_NAMES`, when the document declares
something a tool call cannot carry. The operation is still in the sibling server's `Operations`, so
one handler object serves both: `registerTools` accepts a handler for any operation the document
declares.

| the document declares                                             | refusal                |
| ----------------------------------------------------------------- | ---------------------- |
| a raw or multipart request body                                   | `binary-tool-input`    |
| only request media types that are not JSON                        | `non-json-request`     |
| a request body with no properties to merge into arguments         | `non-object-body`      |
| a streamed response: server-sent events, JSONL                    | `streamed-tool-output` |
| a binary response under a type that is not `image/*` or `audio/*` | `binary-tool-output`   |

## Openness: what a tool advertises about unknown arguments

A tool's `inputSchema` is published from the **input** projection of the emitted Zod schema. That is
deliberate and it is what makes a property with a spec default optional to a caller and guaranteed to
a handler.

By default the emitted objects are open, so `inputSchema` carries no `additionalProperties` and an
unknown argument is **silently stripped** rather than refused. This emitter does not tighten it,
because the validator does not reject unknown keys either and publishing a rule nothing enforces is
the defect this estate exists to remove.

**Set `seal-object-schemas: true` if you want unknown arguments refused.** It seals the OpenAPI
document, the validator and the tool schema together, so all three say the same thing. Measured:
`z.strictObject` carries `additionalProperties: false` on the input projection as well as the output
one, so the option does reach the tool surface.

An operation with no parameters publishes `{"type":"object","additionalProperties":false}`, which is
what the MCP specification recommends. That mirrors the handler's own declared input, which is
`Record<string, never>` for a parameterless operation and open otherwise.

## Argument validation is the SDK's, and so is its error envelope

The MCP SDK validates `params.arguments` against `inputSchema` **before** the tool callback runs, so
this emitter mounts no validation of its own.

**A validation failure therefore does not wear your envelope.** Measured against
`@modelcontextprotocol/server@2.0.0`: an argument of the wrong type produces HTTP 200 with
`isError: true` and the SDK's own message, and the callback never runs -- it is _not_ a JSON-RPC
`-32602` protocol error. Every declared 4xx your handler returns carries that status's own body, as
the document declares it; a bad argument carries the SDK's message instead. That asymmetry is stated
here rather than left to be discovered.

## Diagnostics

**Every diagnostic about the document is a warning, never errors.** A TypeSpec `error` sets `program.hasError()`
and `@typespec/openapi3` then writes nothing, so an error here would cost you the whole document over
one operation this emitter happens not to be able to express. The one error is about configuration,
`runtime-module-removed`, where a warning would let a setting be silently ignored.

Every one is targeted at the operation by **verb and path**, never by name: matching by name never
succeeds for an operation declared inside an `interface`.

### `no-tools-selected`

The tag configuration matched no operation in a service. The message names the tags you configured
**and the tags the service actually declares**, because that is the cheap half of the fix.

Remedy: adjust `tool-tags` or `exclude-tags`, or remove them to select every operation.

### `unrepresentable-tool-name`

The tool name is outside MCP's rule: 1 to 128 characters of `A-Z`, `a-z`, `0-9`, `_`, `-` or `.`.

**Refused, never rewritten.** An operation id is a fact the document publishes; a generated second
spelling of it is a name no reader of the document can predict. TypeSpec permits characters MCP does
not -- `$` arrives through a template instantiation -- so this fires for real specs.

Remedy: name the operation with `@operationId("...")`, or shorten `tool-prefix`.

### `shared-output-dir`

Another emitter in the same program writes to the same `emitter-output-dir` as this one, with
different library options.

Both emitters run `typespec-http-zod`, so both write `schemas.gen.ts`. `emitFile` has no
duplicate-path detection, so that is a silent last-writer-wins and **the order of `emit:` in
`tspconfig.yaml` decides the winner.** Measured on the published packages with divergent
`seal-object-schemas`: one order produced 19 unsealed objects, the other 11 unsealed and 8 sealed --
exit 0 and no diagnostic either time.

Fires **only when the resolved library options differ**. Sharing one directory with matching options
is silent, and is the arrangement worth having: it is what makes one set of validators serve both
surfaces.

The other emitter is counted as running the library when the option schema it publishes accepts
every one of the library's options, whatever it was configured with. An emitter left on its defaults
beside one that sets `compile-schemas` is the case that matters most, and it sets none of them.

With nothing configured this cannot happen at all -- each emitter defaults to a directory named
after itself.

Remedy: give each emitter its own `emitter-output-dir`, or set the same `seal-object-schemas`,
`compile-schemas`, `contracts-package`, `contracts-output-dir`, `key-vocabularies` and
`regenerate-hint` on both.

### `binary-tool-input`

The request body is raw bytes, a stream, or `multipart/form-data`. A tool's arguments are JSON.

**Refused rather than approximated.** Base64-ing a body into a string argument would publish a
contract no reader of the document could predict, and would push a whole upload through a model's
context window.

Remedy: exclude the operation with `exclude-tags`, or declare a JSON-bodied operation for the tool
surface.

### `binary-tool-output`

A response body is raw bytes under a media type MCP has no content block for, such as
`application/octet-stream` or `application/pdf`. A tool result is `text`, `image` and `audio` blocks,
and structured content.

**Refused rather than approximated.** Bytes of any other type could only be an embedded resource, and
a resource needs a URI the document never states. Base64 in a text block would publish an encoding no
reader of the document could predict, and would push a whole download through a model's context
window. Refused where ANY declared response offers such a type, because a handler may answer with any
of them: `image/png | application/octet-stream` is refused.

Remedy: exclude the operation with `exclude-tags`, or declare an `image/*` or `audio/*` media type, or
a JSON body, for the tool surface.

### `streamed-tool-output`

A response is a stream, `SSEStream<...>` or `JsonlStream<...>`. A tool call answers with one message,
and a stream is unbounded and arrives over time.

**Refused rather than approximated.** Buffering it waits on a stream that may never end, and
answering its first event would publish a contract no reader of the document could predict.

Remedy: exclude the operation with `exclude-tags`, or declare an operation that answers once for the
tool surface.

### `unvalidated-response-media-type`

A response declares a model under a media type that is not JSON, most commonly `application/xml`. No
serialisation derives from the schema, so the handler returns that body as a string and the tool
answers it as a `text` block without validating it. Every other response on the operation is
validated as usual.

**A warning, not a refusal**: the text is a tool result, only an unchecked one. The same code, with
the same trigger, as `typespec-hono` raises for the same response.

Remedy: declare a JSON media type, or a string body, to have it checked.

### `non-object-body`

The request body is a scalar, an enum, a union or an array, so it has no properties to merge into a
tool's argument object.

A tool takes **one object**. The document states the body separately from the parameters, so this
emitter merges them -- and there is nothing to merge from `@body body: string`. Naming it under an
invented property would publish a contract no reader of the document could predict, and would break
the handler signature, which receives the bare value.

A body the library already names -- a dictionary body, for instance -- is nested rather than merged
and is never refused.

Remedy: wrap it in a model with a named property, or exclude the operation with `exclude-tags`.

### `non-json-request`

Every declared request media type is one a tool cannot send. Fires only where **no** JSON media type
is declared beside them -- where one is, the tool sends JSON and the others are simply unreachable
from MCP, which is not a defect.

Remedy: declare `application/json` alongside them.

### `headers-only-success`

A 2xx or 3xx response, exact or ranged, carries headers and no body, so the tool answers that status
with nothing a model can read: response headers are carried in `_meta`, which a model does not see.

**Not a refusal** -- the tool is still emitted, because the operation is callable and its effect may
be the point.

Remedy: declare the value in the response body.

### `tool-without-description`

A selected operation has neither `@doc` nor `@summary`. A model chooses tools by their description.

Fires only for operations that became tools: an opinion about an operation that is not a tool is not
this emitter's business.

Remedy: add a doc comment, or `@summary`.

### `runtime-module-removed`

`runtime-module` is set, at the top level or for a service. **An error**, because the option's value
is ignored: `mcp-runtime.gen.ts` is emitted and the generated file imports it, and an emitter that
silently ignored a setting would produce output its author did not ask for.

The option made an application own a copy of generated logic. Nothing it was for needs it now: the
caller context is inferred from `deps.context`, and a handler returns `{ status, body, headers }` for
any response the document declares.

Remedy: remove the option and delete the module it pointed at. See [Upgrading](guides.md#upgrading).

### `tool-name-collision`

Two selected operations produce one tool name.

**Both are refused.** Keeping one would make the tool surface depend on which operation the emitter
reached first: a tool that answers, as the wrong operation.

Remedy: give one an `@operationId`, or set a per-service `tool-prefix`.
