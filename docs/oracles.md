# Oracles

For each thing this emitter writes or decides, the independent thing it must agree with, and the arm
that compares them.

**An artefact with no row here is a pair nobody is comparing.** Adding one to this package means
adding a row, then planting a defect and confirming something goes red.

| artefact or decision                        | must agree with                                                                                         | arm                                                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| the options schema                          | every option `typespec-http-zod` publishes, at both levels                                              | `test/options.test.ts`, as a class                                                                                                              |
| tool selection                              | the tags `getAllTags` reports, including inherited ones                                                 | `test/selection/selection.test.ts`, with a control asserting what `getTags` would have answered                                                 |
| tool names                                  | MCP's own name rule                                                                                     | `test/names/names.test.ts`, including both boundary lengths                                                                                     |
| a name collision                            | itself, in both directions                                                                              | `test/names/names.test.ts` -- BOTH operations refused, and an unrelated tool untouched                                                          |
| `armFor`                                    | the library's own `armFor`, over every arm shape and status class                                       | `test/runtime/parity.test.ts` -- a forced second implementation, so this is what stops it drifting                                              |
| every result `toolResult` produces          | the SDK's own `specTypeSchemas.CallToolResult`                                                          | `test/runtime/result.test.ts`, with a control proving that schema still refuses                                                                 |
| `isError`                                   | the status-class boundary, asserted at exactly 400                                                      | `test/runtime/result.test.ts`                                                                                                                   |
| a response header                           | `_meta`, and never `structuredContent`                                                                  | `test/runtime/result.test.ts`                                                                                                                   |
| the default `runtime-module` branch         | what a bare compile actually emits, and what it imports                                                 | `test/defaults.test.ts` -- the branch every other fixture configures away                                                                       |
| `mcp.gen.ts`                                | the TypeScript compiler, under `strict`, `exactOptionalPropertyTypes`, `noUnusedLocals` and `types: []` | `test/emit/emit.test.ts`, open and sealed                                                                                                       |
| `readOnlyHint` and `idempotentHint`         | IANA's HTTP Method Registry, vendored and sha-pinned                                                    | `test/annotations/annotations.test.ts` -- the emitter reads its own table, the oracle reads IANA's                                              |
| `destructiveHint`                           | nothing external, **and that is stated**                                                                | `test/annotations/annotations.test.ts` -- two derived class assertions instead: no safe method is destructive, and read-only implies idempotent |
| every vendored file                         | the digest recorded for it                                                                              | `test/vendored.test.ts`                                                                                                                         |
| a refusal                                   | the operation's absence from `TOOL_NAMES`, and a diagnostic naming it                                   | `test/refusals/refusals.test.ts`                                                                                                                |
| a warning                                   | the operation's PRESENCE in `TOOL_NAMES`                                                                | `test/refusals/refusals.test.ts` -- a quality complaint must not delete a tool                                                                  |
| `emitted + refused === selected`            | itself, with both terms non-zero                                                                        | asserted in the emitter as a throw; `test/refusals/refusals.test.ts` proves the arithmetic is not `N + 0 === N`                                 |
| `Tools` signatures                          | the sibling server emitter's `Operations`, per operation                                                | `test/agreement/agreement.test.ts` -- one unannotated handler object compiled through both, plus `Identical<>` per operation                    |
| `keyof Tools`                               | `keyof Operations`                                                                                      | `test/agreement/agreement.test.ts`                                                                                                              |
| the agreement fixture                       | being unable to cheat                                                                                   | `test/agreement/agreement.test.ts` -- no cast, one handler object, no annotation                                                                |
| a shared output directory                   | whether the two emitters' library options actually differ                                               | `test/coexistence/coexistence.test.ts` -- silent when they match, loud when they do not, silent when nothing is contested                       |
| the emitted `registerTool` call             | the SDK's OWN canonical example, extracted from its published type declarations                         | `test/golden/golden.test.ts` -- it moves when the SDK moves                                                                                     |
| the module boundaries                       | themselves, pinned                                                                                      | `test/architecture/architecture.test.ts` -- `runtime.ts` imports only what a consumer installs; the renderer never reaches the compiler         |
| the duplicated `securityFor`                | what the sibling emitter WRITES at its own call site                                                    | `test/agreement/agreement.test.ts` -- the sibling does not export it, so the comparison is of rendered literals                                 |
| the documented handler wiring               | the SDK's shape, not a wrapper's                                                                        | `test/golden/golden.test.ts` -- the README once showed the `agents` callable form, which is a `TypeError` against this SDK                      |
| the documented auth gate                    | the SDK's own `requireBearerAuth_fetchGate` example                                                     | `test/golden/golden.test.ts`                                                                                                                    |
| `src/`                                      | reimplementing no part of the SDK's auth story                                                          | `test/golden/golden.test.ts`, comments stripped so a docblock naming it is not a hit                                                            |
| `SCOPES_SUPPORTED`                          | the scopes the document declares                                                                        | `test/golden/golden.test.ts`, and it is the only auth fact this emitter states                                                                  |
| the tool list a caller sees                 | their grant, over the wire                                                                              | `test/acceptance/acceptance.test.ts` -- two grants, two lists, driven through emitted output by a real handler                                  |
| an empty grant                              | a well-formed empty list, never an error                                                                | `test/acceptance/acceptance.test.ts` -- the SDK installs `tools/list` on the FIRST registration, so registering none answers `-32601`           |
| every emitted file, across the whole corpus | the TypeScript compiler                                                                                 | `test/conformance/corpus.test.ts` -- 65 scenarios, and the first run had 41 failing                                                             |
| the scenarios the library refuses           | the diagnostic each is refused under, by name                                                           | `test/conformance/corpus.test.ts` -- named, not counted, so a new failure cannot hide in a tolerance                                            |
| a scenario pinned as upstream-broken        | still being broken                                                                                      | `test/conformance/corpus.test.ts` -- the pin fails when the upstream defect closes                                                              |
| every diagnostic and option                 | `docs/reference.md`, both directions                                                                    | `test/documentation.test.ts`                                                                                                                    |
| every tracked file                          | naming no private codebase, and no host outside an allowlist                                            | `test/provenance.test.ts`, with a positive control proving the scanner still sees                                                               |
| the publisher's identity                    | appearing only in the files that must carry it                                                          | `test/provenance.test.ts`                                                                                                                       |
| every tracked file and every emitted file   | naming no machine path, host, port or transport                                                         | `test/portability.test.ts`                                                                                                                      |
| every tracked file and the whole history    | crediting no tool                                                                                       | `test/attribution.test.ts`                                                                                                                      |
| the package's manifest                      | what it actually ships and imports                                                                      | `test/packaging.test.ts`                                                                                                                        |
| no two suites                               | sharing an output directory                                                                             | `test/isolation.test.ts`                                                                                                                        |

## Not yet built

Named here so their absence is deliberate rather than forgotten. Each arrives with the stage that
produces the artefact it grades.

- `isError` against `EmittedRoute.errorArms`, corpus-wide -- the arm that proves the status-class
  derivation and the document's declared failures cannot part company.
- `inputSchema` against the parameters and request body `@typespec/openapi3` publishes.
- `outputSchema` against the document's success response body.
- The published `tools/list` payload against a budget decomposed by source.
- Wire openness against the tool's actual behaviour.

## Planting a defect: the control that proved nothing

Every row above is trusted only after its defect has been planted, seen red, and restored from a byte
copy compared with `cmp`.

**A plant must assert that it applied.** The `armFor` control here reported green on its first run and
proved nothing: the plant was a string replacement, the formatter had since reparenthesised the
function, the replacement matched nothing, and the file was never modified. A control that silently
no-ops looks exactly like a guard that holds.

So a plant either asserts the text changed, or fails loudly. Re-run with that assertion, the same
control turned red naming five specific disagreements.

**The assertion must be `changed !== original`, not `anchor in source`.** That distinction has cost
three false green controls in this repository. Checking that an anchor is PRESENT says nothing about
whether the replacement that follows it matched: a `.replace()` whose second argument never fires
leaves the file untouched, the suite passes, and the control reports a guard that was never tested.

## Why the agreement arm asserts identity, not assignability

One handler object satisfying both `Operations` and `Tools` proves the object is assignable to each.
It does **not** prove the two interfaces are the same.

Measured, by planting a widened MCP input (`{ surplus?: string }` intersected into every handler
input): the handler object stayed assignable to both surfaces and `registerRoutes` and
`registerTools` both accepted it. Nothing about the value-level half went red. The `Identical<>`
assertions caught it -- `TS2344: Type 'false' does not satisfy the constraint 'true'` on five
operations.

So an arm written only as "one object satisfies both" would have passed while the two surfaces
disagreed about what a handler receives. Note the trap the library's own docblock records:
`Identical<A, B> & true` merely produces an odd type, and **only a constraint violation is an
error** -- which is what `MustHold<T extends true>` exists for.

The other control, a handler for an operation the spec never declared, reddens **both** guards at
once: the sibling's `Exhaustive` and this package's `ToolsExhaustive`. That is the removal guard
surviving in both surfaces from one object, which is the design claim stated as a compile error.
