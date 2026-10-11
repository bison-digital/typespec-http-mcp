# `typespec-http-mcp`, where this work stands

Working record. Everything here is measured; where a number appears, it came from a command.

## START HERE

**State, 2026-09-13.** A fourth sibling to `typespec-http-zod`, `typespec-hono` and
`typespec-openapi-document`. Emits an MCP tool surface from an HTTP service definition, dispatching
into **the same handler object** a generated Hono server calls.

**All five gates green by exit code**: `build`, `test`, `typecheck`, `lint`,
`format:check`. `pnpm test` is two vitest projects; `pnpm test:unit` is the fast one for the edit
loop. Zero lint warnings. CI runs the same five gates on Node 22 and 24 and is green.

**The repository is public.** `0.1.0` was published on 2026-09-16; `0.2.0` is being prepared.
Publishing is public and permanent, and needs the maintainer's explicit approval.

**Three numbers to lead a report with: corpus scenarios / emitted files that compile / defects
pinned as upstream. Today they are `66 / 66 / 0`.**

**Versions this is built and tested against**, all current as of 2026-09-13: TypeSpec 1.16.0 /
0.86.0, `typespec-http-zod@0.25.0` from the registry, `typespec-hono@0.22.0`, zod 4.6.2, hono
4.13.7, vitest 5, wrangler 4.131.1, and the conformance corpus at `0.1.0-alpha.43`.

### Publishing, when there is a reason to

**Nothing blocks it.** The `link:` override is gone, `typespec-http-zod@0.25.0` resolves from the
registry, and `release.yml`'s guard against a locally-linked first-party dependency now passes as a
no-op that still catches a regression.

`docs/releasing.md` has the recipe. In short: the version is already `0.1.0` and the CHANGELOG
already names it, so it is bump-if-needed, four gates by exit code, `git tag v0.1.0`,
`git push origin main`, then `git push origin refs/tags/v0.1.0` **separately** -- lightweight tags do
not travel with `--follow-tags`. Confirm by SHA with `gh run list --json headSha,conclusion`, then by
`npm view typespec-http-mcp version`. The registry lags the workflow by a minute; that is not a
failure.

**Git operations here are over SSH.** The remote is `git@github.com:...`. An HTTPS remote falls
through to an OAuth token that has no `workflow` scope and the push is rejected for touching
`.github/workflows/`. That is a property of the remote URL, not of the account.

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
  auth. Over a real socket the problem does not arise, which is one more reason `test/socket/` is
  worth its weight.

### Three traps in the socket harness, each of which cost a confusing failure

- **`allowBuilds`, not `onlyBuiltDependencies`.** pnpm 11 renamed the key. The old one is accepted in
  `pnpm-workspace.yaml` and silently does nothing, so `pnpm install` keeps exiting 1 with
  `ERR_PNPM_IGNORED_BUILDS` while the config looks correct. The same trap the `overrides` comment at
  the top of that file already warns about.
- **`dev.port` must be `0`.** wrangler's default is a fixed `8787`. A second run of the suite, or a
  stray worker from a killed one, dies inside workerd with
  `failed: ::bind(...): Address already in use` -- which reads like a workerd bug and is a port
  collision. The suite reads the port back off the started worker.
- **`unstable_startWorker` is re-exported under an alias.** Grepping the type declarations for
  `declare function unstable_startWorker` finds nothing; it is `startWorker as unstable_startWorker`
  in the export list. It returns `{ ready, url: Promise<URL>, dispose() }`.

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

## Open

The four engineering items that stood here on 2026-08-29 are closed. What is left:

1. **Publish `0.1.0`**, when there is a project that wants it. Not blocked; see above.
2. **`typespec-http-zod` needs the same Tier 2 treatment.** Its emitted server has never been
   bundled or run on workerd either, and the arm here found a live hole in an architecture rule that
   package shares the shape of.
3. **The library's own finding 2 is still open**: nothing compiles the conformance corpus's emitted
   output _in that package_. This package compiles all 65, which is why `as` and `yield` were caught
   here rather than there -- a defect in the library was invisible to the library.

### What the four items produced, briefly

- **Tier 2 acceptance.** `test/socket/` bundles the documented Worker with esbuild, serves it on
  workerd with `compatibility_flags: []`, and drives it with `@modelcontextprotocol/client` over a
  real socket. Three concurrent callers of ONE deployment see three different tool lists. Three
  controls, each proven red: `deps` hoisted to module scope, the `agents` callable form, and
  `node:fs` in the copied runtime.
- **`architecture.test.ts` could not see a Node builtin in `runtime.ts`.** Its closure skips every
  `node:` specifier so `emitter.ts` may read the filesystem -- correct for every module except the
  one copied verbatim into a consumer's Workers build. The plant left all ten arms green and failed
  five socket arms. There is an arm for it now.
- **`as` and `yield` fixed in the library.** Both contextual, both refused in a declaration position,
  both absent from the reserved set -- and the fixture that was supposed to guard the set declared
  only words the set already knew, so it graded the set against itself. The corpus is now 65/65.
- **Versioned and multi-service scenarios are asserted**, not merely compiled. The emitter emits the
  latest version's surface, and a parameter removed at the served version does not survive as a tool
  argument. Multi-service had never been compiled at all.

## How this work is done

The sibling emitters share a working method, kept outside this repository. Two additions earned here:

- **A plant must assert `changed !== original`, not `anchor in source`.** That distinction cost three
  false-green controls in this repository. A `.replace()` that matches nothing leaves the file
  untouched, the suite passes, and the control reports a guard that was never tested.
- **Run the gates BEFORE committing, one at a time.** Two commits landed with `typecheck = 1`, and a
  back-to-back gate loop reported `test = 143` (SIGTERM) that was not a real failure. Check by exit
  code, individually.
