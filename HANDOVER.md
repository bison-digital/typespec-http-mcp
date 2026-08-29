# `typespec-http-mcp`, where this work stands

Working record. Everything here is measured; where a number appears, it came from a command.

## START HERE

**State, 2026-08-29.** A fourth sibling to `typespec-http-zod`, `typespec-hono` and
`typespec-openapi-document`. Emits an MCP tool surface from an HTTP service definition, dispatching
into **the same handler object** a generated Hono server calls.

**171 tests, 22 files. All five gates green by exit code**: `build`, `test`, `typecheck`, `lint`,
`format:check`. `pnpm test` takes ~32s, most of it the corpus arm.

**Nothing is published and there is no git remote.** 13 commits on `main`, local only.
`typespec-http-zod` has **1 unpushed commit** (its `0.25.0`), also local. Publishing is public,
permanent, and needs Zach's explicit approval.

**Three numbers to lead a report with: corpus scenarios / emitted files that compile / defects
pinned as upstream. Today they are `65 / 64 / 1`.**

### The release is BLOCKED, and correctly

`pnpm-workspace.yaml` carries `overrides: typespec-http-zod: "link:../typespec-http-zod"`, because
`0.25.0` is not published. `.github/workflows/release.yml` refuses to publish while that line exists,
and that guard is load-bearing rather than ceremonial: `--frozen-lockfile` exits 0 on a dangling
link, so a release checkout with no sibling on disk installs happily and fails four steps later as a
wall of `TS2307` naming the module but not the cause.

**Release order is fixed:** `typespec-http-zod@0.25.0` first, then remove the override, re-install so
the lockfile resolves from the registry, then `typespec-http-mcp@0.1.0`.

### The six things most easily lost

1. **A consumer lists ONE emitter.** This package runs the whole library and adds `mcp.gen.ts` and
   `mcp-runtime.gen.ts`. Tool schemas are imported BY NAME from `schemas.gen.js`, using the
   identifiers `EmittedService.schemaNames` hands back. Never re-mint them.
2. **`createMcpHandler` returns an OBJECT, not a callable.** `handler.fetch(request)`. The callable
   form is Cloudflare `agents`' shape and gives `TypeError: handler is not a function`. This shipped
   in the README once; `test/golden/golden.test.ts` now refuses it.
3. **`deps` is built INSIDE the factory, per request.** The factory receives that request's verified
   identity. Built once at module scope, `permits` closes over no caller and every client sees an
   identical tool list -- which makes the per-caller filtering this emitter is built around inert.
   This also shipped once.
4. **Every tool is registered, then the unpermitted ones `remove()`d.** The SDK installs the
   `tools/list` handler on the FIRST `registerTool`, so registering none answers `-32601 Method not
found` at HTTP 404 -- a caller who may see nothing is told the server HAS nothing.
   `setToolRequestHandlers()` would be the direct fix and is **private in the published types**.
5. **Refusals are `warning`, never `error`.** An error sets `program.hasError()` and
   `@typespec/openapi3` then writes no document at all.
6. **`getAllTags`, never `getTags`.** `getTags` returns only an operation's own tags, so every
   operation inside a `@tag`-carrying interface reports none and is silently dropped.

### Protocol traps, each of which costs a confusing failure

Owned by one helper. Do not rediscover them.

- **`LATEST_PROTOCOL_VERSION` is stale.** It reads `2025-11-25`; the stateless HTTP handler accepts
  only `2026-07-28`. Written as a literal, kept honest by an arm that reads `data.supported` back out
  of a deliberate `-32022`.
- **`Mcp-Method` is required and must agree with the body**; `Mcp-Name` is required for `tools/call`.
- **An in-process `Request` synthesises no `Host`** and the handler answers
  `403 {"code":-32000,"message":"Missing Host header"}`. That is the DNS-rebinding check, **not**
  auth.

## Architecture

`docs/architecture.md` has the layer map and the rules. Three are enforced by
`test/architecture/architecture.test.ts` rather than intended:

- **`runtime.ts` imports only what a consumer installs.** It is copied verbatim into their output,
  so a build-time import there is a broken deploy found at deploy time and nowhere earlier.
- **The renderer never reaches the TypeSpec compiler**, even transitively.
- **The package name is a literal in exactly one module**, because `coexistence.ts` finds this
  emitter in the compiler's options map by name.

Two duplications are permanent and each has a parity oracle: `ResponseArm`/`armFor` against the
library's own, and the `Fields`/`Produced` helper text against the sibling emitter. Both follow from
emitted output having to be self-contained. A third, `securityFor`, was **removed** in
`typespec-http-zod@0.25.0`, which now publishes `EmittedRoute.security`.

## Authentication

Everything except one fact is the SDK's, and none of it is reimplemented here:
`requireBearerAuth`, `bearerAuthChallengeResponse`, `oauthMetadataResponse`,
`buildOAuthProtectedResourceMetadata`, `getOAuthProtectedResourceMetadataUrl`. An arm asserts `src/`
reimplements no part of it, with comments stripped so a docblock naming it is not a hit.

The one fact this emitter contributes is **`SCOPES_SUPPORTED`** -- the union of scopes the document
declares, for RFC 9728's `scopes_supported`. `docs/guides.md` has the wiring, pinned to the SDK's own
`requireBearerAuth_fetchGate` example.

## What the oracles are

`docs/oracles.md` is the table, and its governing rule is mechanical: `documentation.test.ts` fails
if a suite has no row, or a row names a suite that is gone. The load-bearing ones:

- **`test/conformance/corpus.test.ts`** -- 65 scenarios emitted AND compiled. Its first run had 41
  failing. Emitting is not the assertion; compiling is.
- **`test/agreement/agreement.test.ts`** -- one unannotated handler object through both
  `registerRoutes` and `registerTools`, plus `Identical<>` per operation. Identity rather than
  assignability, and the control is why: a widened MCP input left the object assignable to both while
  `Identical<>` reported false on five operations.
- **`test/acceptance/acceptance.test.ts`** -- two grants, two tool lists, over the wire through
  emitted output. Found the 404 above on its first run.
- **`test/golden/golden.test.ts`** -- graded against the SDK's own canonical examples, extracted from
  its published type declarations so they move when the SDK moves.
- **`test/annotations/`** -- graded against IANA's HTTP Method Registry, vendored and sha-pinned.

## Defects found, and where they came from

Every one came from running something, and the pattern is worth internalising: **each was invisible
to the arms that existed at the time.**

- Three fixtures passed while **41 of 65 corpus files did not compile**. Five distinct defects:
  non-object bodies, `@discriminator` bodies, typed index signatures lost in the merge, and two
  classes of unconditionally-emitted declaration.
- A **404 for a caller whose grant permits nothing**, found by the first arm that ran a value through
  the surface a client sees.
- **Documented wiring that could not filter per caller**, found by reading the docs against the
  factory signature.
- A **README that gave `TypeError`**, found while probing auth.
- `EmittedRoute.verb` is UPPERCASE and `HttpOperation.verb` is lowercase; a case-sensitive lookup
  matched nothing and blamed the tag configuration.

## Open, in the order I would take them

1. **Tier 2 acceptance: a real client over a real socket**, `wrangler dev`. Everything is in-process.
   This is the last place a difference can hide, and I would not call the package finished without it.
2. **The library's `special-words` defect.** A model named `as` emits `export type as = ...`, a
   syntax error. Reproduced with `typespec-http-zod` alone. Pinned in
   `LIBRARY_EMITS_UNCOMPILABLE`, and the pin FAILS when it is fixed, so closing it is deliberate.
3. **Assert what the versioned and multi-service scenarios EMIT.** They compile; nothing checks what
   they say.
4. **The corpus arm adds ~25s to `pnpm test`.** Consider its own vitest project.
5. **Release**, on Zach's word, in the order above.

## How this work is done

`SESSION-HANDOVER.md` in the parent directory carries the estate's method. Two additions earned here:

- **A plant must assert `changed !== original`, not `anchor in source`.** That distinction cost three
  false-green controls in this repository. A `.replace()` that matches nothing leaves the file
  untouched, the suite passes, and the control reports a guard that was never tested.
- **Run the gates BEFORE committing, one at a time.** Two commits landed with `typecheck = 1`, and a
  back-to-back gate loop reported `test = 143` (SIGTERM) that was not a real failure. Check by exit
  code, individually.
