# Reference

Every option this emitter accepts and every diagnostic it can raise.
`test/documentation.test.ts` grades this file against `$lib` in both directions, so an option or a
diagnostic that exists and is not here fails the suite, and so does one written here that does not
exist.

## Options

This emitter runs the whole of `typespec-http-zod`, so **every option that library accepts also
reaches it**, derived from its published schema rather than restated. Those are documented in that
package; they are listed here because this file is graded as a class.

| option                       | default                | what it does                                                                           |
| ---------------------------- | ---------------------- | -------------------------------------------------------------------------------------- |
| `contracts-output-dir`       | unset                  | Forwarded to the library.                                                              |
| `contracts-package`          | unset                  | Forwarded to the library.                                                              |
| `seal-object-schemas`        | `false`                | Forwarded to the library. **It also decides the tool surface**: see _Openness_ below.  |
| `compile-schemas`            | unset                  | Forwarded to the library.                                                              |
| `key-vocabularies`           | unset                  | Forwarded to the library.                                                              |
| `runtime-module`             | `./mcp-runtime.gen.js` | Where emitted output imports its runtime contract from.                                |
| `regenerate-hint`            | unset                  | The command named in the generated banner.                                             |
| `services`                   | unset                  | Per-service overrides. Every option above may be set per service, plus the four below. |
| `tool-tags`                  | unset                  | Tags that mark an operation as a tool. **Unset means every operation is one.**         |
| `exclude-tags`               | `[]`                   | Tags that exclude an operation, even when `tool-tags` selected it.                     |
| `tool-prefix`                | unset                  | Prepended to every tool name, verbatim.                                                |
| `services.<name>.emit-tools` | `true`                 | Set `false` for a service that is in the program only for its types.                   |

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

Defaults to `./mcp-runtime.gen.js`, **not** `./runtime.gen.js`. If you also emit a server from the
same spec into the same directory, the two emitters would otherwise both claim `runtime.gen.ts`.
`emitFile` has no duplicate-path detection, so that is a silent last-writer-wins decided by the order
of `emit:` in `tspconfig.yaml`. With distinct runtime filenames the only file the two can contest is
`schemas.gen.ts`, which is byte-identical under identical options.

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
`-32602` protocol error. Every declared 4xx from your own handler goes through your `respond` and
looks the way you decided; a bad argument does not. That asymmetry is stated here rather than left to
be discovered.

## Diagnostics

**All warnings, never errors.** A TypeSpec `error` sets `program.hasError()` and `@typespec/openapi3`
then writes nothing, so an error here would cost you the whole document over one operation this
emitter happens not to be able to express.

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
is silent, and is the arrangement worth having: it is what makes one `Ctx`, one `Result` and one set
of validators serve both surfaces.

With nothing configured this cannot happen at all -- each emitter defaults to a directory named
after itself.

Remedy: give each emitter its own `emitter-output-dir`, or set the same `runtime-module`,
`seal-object-schemas`, `compile-schemas`, `contracts-package`, `contracts-output-dir`,
`key-vocabularies` and `regenerate-hint` on both.

### `binary-tool-input`

The request body is raw bytes, a stream, or `multipart/form-data`. A tool's arguments are JSON.

**Refused rather than approximated.** Base64-ing a body into a string argument would publish a
contract no reader of the document could predict, and would push a whole upload through a model's
context window.

Remedy: exclude the operation with `exclude-tags`, or declare a JSON-bodied operation for the tool
surface.

### `non-json-request`

Every declared request media type is one a tool cannot send. Fires only where **no** JSON media type
is declared beside them -- where one is, the tool sends JSON and the others are simply unreachable
from MCP, which is not a defect.

Remedy: declare `application/json` alongside them.

### `headers-only-success`

The success response carries headers and no body, so the tool returns nothing a model can read:
response headers are carried in `_meta`, which a model does not see.

**Not a refusal** -- the tool is still emitted, because the operation is callable and its effect may
be the point.

Remedy: declare the value in the response body.

### `tool-without-description`

A selected operation has neither `@doc` nor `@summary`. A model chooses tools by their description.

Fires only for operations that became tools: an opinion about an operation that is not a tool is not
this emitter's business.

Remedy: add a doc comment, or `@summary`.

### `tool-name-collision`

Two selected operations produce one tool name.

**Both are refused.** Keeping one would make the tool surface depend on which operation the emitter
reached first: a tool that answers, as the wrong operation.

Remedy: give one an `@operationId`, or set a per-service `tool-prefix`.
