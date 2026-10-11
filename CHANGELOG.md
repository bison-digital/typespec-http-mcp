# Changelog

## [Unreleased]

Upgrading: [what to check before you take this](docs/guides.md#to-020).

Requires `typespec-http-zod` 0.28.0 and pairs with `typespec-hono` 0.25.0. `test/agreement/` and the
new corpus arm hold every tool signature identical to the server handler's.

### Changed, breaking

- **An `Http.File` operation is a tool only where a tool can carry the file.** A download is answered
  as the `image` or `audio` block its media type names, and refused with `binary-tool-output` under
  any other type; an upload is refused with `binary-tool-input`, where an upload declared only under
  a type that is not JSON was refused as `non-json-request`. 0.1.0 published such operations as
  tools that answered `content: []` and dropped the uploaded file. Removed from `TOOL_NAMES` and
  `Tools`, so a handler object that `satisfies` `Tools` and names one no longer compiles; one that
  `satisfies` the server's `Operations` and is passed to `registerTools` still does.
- **A response header declared with `@encode` takes its encoded type**: `@encode(seconds, int32)
retryAfter: duration` is a `number`, where it was a `string`, which is what its schema checks.
- **The validators move from `typespec-http-zod` 0.26.0 to 0.28.0**, so 0.27.0's changes arrive too:
  a declared integer width is enforced (`z.int32()`), so a tool argument outside it is refused, and a
  `@pattern` is compiled with the Unicode flag. See [To 0.2.0](docs/guides.md#to-020).

- **A result's body is typed from the schema's input, `Produced<z.input<...>>`**, as the server
  types it. A property with a default may be left out of a returned body, because the runtime fills
  it before answering, and a plain optional property is `?: T`, because `.exactOptional()` refuses
  an explicit `undefined`.
- **An optional request body is `body?: T` in the handler's input**, with no `| undefined`: an
  absent body is an absent key, as the server hands it over.
- **A binary result body is `ByteStream | Uint8Array<ArrayBuffer> | ArrayBuffer`**, where it was
  `ReadableStream | ...`. `ByteStream` is exported from `mcp-runtime.gen.ts` and is the same type
  `requests.gen.ts` and `typespec-hono`'s runtime declare. A platform `ReadableStream` still
  satisfies it, so a handler returning one compiles as before. Any such stream is read through its
  reader: a read reporting no chunk is read past, and a stream refused for a chunk that is not bytes
  is cancelled as well as released.
- **An empty model contributes `{}` to a handler's input**, not `unknown`, as the server types it.
- **A tool on a negotiated route hands its handler `accept`.** On a route several operations share,
  the server's handler receives its operation's `accept` literal; the tool's did not, so one handler
  object could not serve both. The tool supplies the literal itself, and the caller is never asked
  for it.

### Fixed

- **The emitted runtime compiles under `erasableSyntaxOnly`.** Its error classes declared their
  fields as constructor parameter properties, which are not erasable syntax, so a project building
  with that flag had to turn it off. The corpus is typechecked with it, and with
  `noPropertyAccessFromIndexSignature`, now.
- **Each operation on a shared route is its own tool: its own description, its own tags and its
  own diagnostics.** Operations were looked up by verb and path, which `@sharedRoute` gives every
  member, so each member published one member's doc comment as its description, was selected by
  that member's tags, and had its warnings raised against it. They are read by operation id from
  the library's `EmittedService.operations`.
- **A tool whose body the document makes optional can be called without one.** The handler's input
  said `body?:` while the tool's schema required it, so such a call was refused by argument
  validation before it reached the handler.
- **A binary result from any stream of `Uint8Array` chunks is answered.** The runtime read only the
  platform's `ReadableStream`, and refused a stream that is only a reader, which is how a backend
  typed by the contract types hands one back. It is read through its reader, which is released.
- **An `Http.File` response is answered as the `image` or `audio` block its media type names.** The
  library read no file body, so the result type declared none and the tool answered `content: []`.
- **A cookie parameter is merged into a tool's arguments**, as a header already is.

### Changed

- **`@typespec/openapi` is a declared peer, and the README installs it.** `typespec-http-zod` requires
  it, and this package did not say so: following the README on TypeSpec 1.15 or 1.16, a package
  manager installed `@typespec/openapi` at its newest, whose peers are the newest compiler, so a
  strict-peer install failed. The install line names the three `@typespec` packages, to be
  installed at one version.
- **Built and graded against TypeSpec 1.17.**
- **The result rules and the status table are the library's**, `resultMembersOf` and
  `STATUS_CODES`. This package held a copy of both.

### Added (graded, not shipped)

- **`test/conformance/agreement.test.ts`: every tool signature against the server handler's, over
  the whole corpus**, both emitters in one program per scenario. Its first run found the missing
  `accept` above, and planting `unknown` back into `Fields` fails it on three scenarios.

## [0.1.0] - 2026-09-16

First published release. Requires `typespec-http-zod` 0.26.0 and pairs with `typespec-hono` 0.23.0:
one handler object satisfies both surfaces, and `test/agreement/` holds every result type identical.

The sections below record what changed between the package being written and being published.

### Breaking

- **A handler returns `{ status, body, headers }` for any response the document declares**, failures
  included. Each operation has a result union, `<OperationId>Result`, the same type the sibling
  server emitter declares, and `Tools<C>` types every handler as a property
  `(ctx: C, input) => Awaitable<Result>`.
- **`deps.respond` is removed**, along with `Result<T>`, `Ctx`, `statusOf` and an arm's `when`. The
  generated callback returns `toolResult(declared, operationId, result)`, which selects the arm by
  `result.status`, parses a JSON body against that status's schema and answers the parsed value,
  throws `ResponseContractError` for a body the schema refuses and `UndeclaredStatusError` for a
  status no response governs, sets `isError` from the status, and carries declared response headers
  in `_meta["typespec-http-mcp/response-headers"]` by wire name.
- **`ToolDeps<C>` and `registerTools<C, T>`**: the caller context is inferred from what
  `deps.context` returns rather than declared in a substituted module.
- **`runtime-module` is refused with `runtime-module-removed`, an error.** `mcp-runtime.gen.ts` is
  written on every compile and the generated file always imports it.
- **`outputSchema` is published only where every 2xx and 3xx response shares one JSON body**, the
  body of the lowest exact status. The SDK refuses a success without `structuredContent` once a tool
  declares an `outputSchema`, so an operation with two success bodies, or a bodyless success beside a
  bodied one, publishes none.
- `headers-only-success` reads each declared response: it fires for any 2xx or 3xx response with
  headers and no body.
- **`toolResult` is asynchronous**, because a binary body may be a stream it reads to the end.
- **A body that is not JSON is answered as the MCP content block for its kind.** A string under
  `text/plain` is parsed against its schema and answered as a `text` block. Bytes under `image/*` or
  `audio/*` are answered as an `image` or `audio` block with base64 `data` and the served `mimeType`,
  from a `Uint8Array`, an `ArrayBuffer` or a `ReadableStream`. A model under `application/xml` is the
  text the handler supplies, unvalidated. The generated call passes the kinds as
  `ToolResponses.bodies`, keyed by status, only where one applies.
- **New refusals, `binary-tool-output` and `streamed-tool-output`**: an operation answering bytes no
  content block carries, or a stream, is not a tool.
- **A 2xx or 3xx answered through `default` must meet the published `outputSchema`**, and throws
  `ResponseContractError` when it does not, where the SDK used to answer "no structured content".

### Added

- `unvalidated-response-media-type`, the warning `typespec-hono` raises for a model served under a
  media type that is not JSON, with the same trigger.

### Fixed

- **An operation whose body is a scalar, enum or union is a tool again.** It was refused as
  `non-object-body` because the library merged such a body into the parameters; the library names it
  now, so it arrives as an ordinary `body` argument. `versioning/returnTypeChangedFrom` left the
  corpus's "every operation refused" list as a result. The refusal still stands for a body this
  emitter cannot carry.

- **`deps.context` is told `"optional"` for an operation offering an anonymous alternative beside a
  real one** (`NoAuth | BearerAuth`). It was told `"none"`, from the library's `noAuth`, so a caller
  presenting a valid credential was never recognised on such a tool. The argument is now
  `"none" | "optional" | "required"`, read from `EmittedRoute.authentication`.
- **`permits` receives the `security` the document publishes**, so an anonymous alternative is the
  empty requirement `{}`: `@useAuth(NoAuth)` is `[{}]`, where it was `[]`. A `permits` that treats a
  requirement as satisfied when every scheme in it is still authorises it.

- `shared-output-dir` counts another emitter as running `typespec-http-zod` when its published option
  schema accepts the library's options. It used to require that one of them was SET, so an emitter on
  its defaults beside one setting `compile-schemas` rewrote `schemas.gen.ts` with nothing said. Every
  arm had configured `runtime-module` on both emitters, which hid it.
- A media type range such as `image/*` admits the concrete type a handler answers with, which it
  used to refuse as undeclared. The handler's `contentType` is typed `` `image/${string}` ``, the type
  the server emitter gives it, and the range's own spelling or a type with no subtype is refused.

### What the package was when it was written

- The emitter skeleton: options derived from `typespec-http-zod`'s published schema at both levels,
  never restated.
- Tool selection by `@tag`, read with `getAllTags` so a tag on an interface or namespace reaches the
  operations inside it.
- Tool naming from the operation id, refused rather than re-spelled when MCP cannot carry it.
- Diagnostics: `no-tools-selected`, `unrepresentable-tool-name`, `tool-name-collision`.

- The tool surface: `registerTools`, the `Tools` interface, the merged argument schemas, and the
  `./runtime` entry point the emitted files import from.
- Refusals for what MCP cannot carry: `binary-tool-input`, `non-object-body`, `non-json-request`,
  each a warning rather than an error so `@typespec/openapi3` still writes its document.
- `SCOPES_SUPPORTED`, the union of scopes the document declares, for RFC 9728's `scopes_supported`.
  It is the only authentication fact this emitter states; everything else is the SDK's.
- Annotations derived from IANA's HTTP Method Registry, vendored and sha-pinned.
- A tool description is rendered into the emitted JSDoc through `typespec-http-zod`'s
  `jsDocComment`, so a description containing a comment terminator cannot stop the emitted file
  compiling. The runtime copy, which is the one a model actually reads when choosing a tool, has
  always gone through `JSON.stringify` and is unchanged; the comment three lines above it had not.

Evidence, all of it added before the first release rather than after a report:

- **65 of 65 conformance scenarios emit output that compiles**, with no exceptions list.
- **A Tier 2 acceptance arm**: the documented Worker, bundled by esbuild, served by workerd with no
  `nodejs_compat`, driven by `@modelcontextprotocol/client` over a real socket. Three concurrent
  callers of one deployment see three different tool lists.
- **A versioned spec emits the latest version's surface**, asserted rather than assumed, including
  that a parameter removed at the served version does not survive as a tool argument.
- **Two services in one program each get their own output directory**, operations and validators.

`typespec-http-zod@0.25.0` is required and is not published yet, so `pnpm-workspace.yaml` redirects
it to a sibling checkout and `.github/workflows/release.yml` refuses to publish while it does.
