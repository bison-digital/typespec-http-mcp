# Oracles

For each thing this emitter writes or decides, the independent thing it must agree with, and the arm
that compares them.

**An artefact with no row here is a pair nobody is comparing.** Adding one to this package means
adding a row, then planting a defect and confirming something goes red.

| artefact or decision                      | must agree with                                                                                         | arm                                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| the options schema                        | every option `typespec-http-zod` publishes, at both levels                                              | `test/options.test.ts`, as a class                                                                                                              |
| tool selection                            | the tags `getAllTags` reports, including inherited ones                                                 | `test/selection/selection.test.ts`, with a control asserting what `getTags` would have answered                                                 |
| tool names                                | MCP's own name rule                                                                                     | `test/names/names.test.ts`, including both boundary lengths                                                                                     |
| a name collision                          | itself, in both directions                                                                              | `test/names/names.test.ts` -- BOTH operations refused, and an unrelated tool untouched                                                          |
| `armFor`                                  | the library's own `armFor`, over every arm shape and status class                                       | `test/runtime/parity.test.ts` -- a forced second implementation, so this is what stops it drifting                                              |
| every result `toolResult` produces        | the SDK's own `specTypeSchemas.CallToolResult`                                                          | `test/runtime/result.test.ts`, with a control proving that schema still refuses                                                                 |
| `isError`                                 | the status-class boundary, asserted at exactly 400                                                      | `test/runtime/result.test.ts`                                                                                                                   |
| a response header                         | `_meta`, and never `structuredContent`                                                                  | `test/runtime/result.test.ts`                                                                                                                   |
| the default `runtime-module` branch       | what a bare compile actually emits, and what it imports                                                 | `test/defaults.test.ts` -- the branch every other fixture configures away                                                                       |
| `mcp.gen.ts`                              | the TypeScript compiler, under `strict`, `exactOptionalPropertyTypes`, `noUnusedLocals` and `types: []` | `test/emit/emit.test.ts`, open and sealed                                                                                                       |
| `readOnlyHint` and `idempotentHint`       | IANA's HTTP Method Registry, vendored and sha-pinned                                                    | `test/annotations/annotations.test.ts` -- the emitter reads its own table, the oracle reads IANA's                                              |
| `destructiveHint`                         | nothing external, **and that is stated**                                                                | `test/annotations/annotations.test.ts` -- two derived class assertions instead: no safe method is destructive, and read-only implies idempotent |
| every vendored file                       | the digest recorded for it                                                                              | `test/vendored.test.ts`                                                                                                                         |
| a refusal                                 | the operation's absence from `TOOL_NAMES`, and a diagnostic naming it                                   | `test/refusals/refusals.test.ts`                                                                                                                |
| a warning                                 | the operation's PRESENCE in `TOOL_NAMES`                                                                | `test/refusals/refusals.test.ts` -- a quality complaint must not delete a tool                                                                  |
| `emitted + refused === selected`          | itself, with both terms non-zero                                                                        | asserted in the emitter as a throw; `test/refusals/refusals.test.ts` proves the arithmetic is not `N + 0 === N`                                 |
| every diagnostic and option               | `docs/reference.md`, both directions                                                                    | `test/documentation.test.ts`                                                                                                                    |
| every tracked file                        | naming no private codebase, and no host outside an allowlist                                            | `test/provenance.test.ts`, with a positive control proving the scanner still sees                                                               |
| the publisher's identity                  | appearing only in the files that must carry it                                                          | `test/provenance.test.ts`                                                                                                                       |
| every tracked file and every emitted file | naming no machine path, host, port or transport                                                         | `test/portability.test.ts`                                                                                                                      |
| every tracked file and the whole history  | crediting no tool                                                                                       | `test/attribution.test.ts`                                                                                                                      |
| the package's manifest                    | what it actually ships and imports                                                                      | `test/packaging.test.ts`                                                                                                                        |
| no two suites                             | sharing an output directory                                                                             | `test/isolation.test.ts`                                                                                                                        |

## Not yet built

Named here so their absence is deliberate rather than forgotten. Each arrives with the stage that
produces the artefact it grades.

- `isError` against `EmittedRoute.errorArms`, corpus-wide -- the arm that proves the status-class
  derivation and the document's declared failures cannot part company.
- `inputSchema` against the parameters and request body `@typespec/openapi3` publishes.
- `outputSchema` against the document's success response body.
- The handler signatures against a generated HTTP server's, compiled as one object through both.
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
