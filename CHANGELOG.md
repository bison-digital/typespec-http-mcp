# Changelog

## 0.1.0

Unreleased.

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
