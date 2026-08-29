# Oracles

For each thing this emitter writes or decides, the independent thing it must agree with, and the arm
that compares them.

**An artefact with no row here is a pair nobody is comparing.** Adding one to this package means
adding a row, then planting a defect and confirming something goes red.

| artefact or decision                      | must agree with                                              | arm                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| the options schema                        | every option `typespec-http-zod` publishes, at both levels   | `test/options.test.ts`, as a class                                                              |
| tool selection                            | the tags `getAllTags` reports, including inherited ones      | `test/selection/selection.test.ts`, with a control asserting what `getTags` would have answered |
| tool names                                | MCP's own name rule                                          | `test/names/names.test.ts`, including both boundary lengths                                     |
| a name collision                          | itself, in both directions                                   | `test/names/names.test.ts` -- BOTH operations refused, and an unrelated tool untouched          |
| every diagnostic and option               | `docs/reference.md`, both directions                         | `test/documentation.test.ts`                                                                    |
| every tracked file                        | naming no private codebase, and no host outside an allowlist | `test/provenance.test.ts`, with a positive control proving the scanner still sees               |
| the publisher's identity                  | appearing only in the files that must carry it               | `test/provenance.test.ts`                                                                       |
| every tracked file and every emitted file | naming no machine path, host, port or transport              | `test/portability.test.ts`                                                                      |
| every tracked file and the whole history  | crediting no tool                                            | `test/attribution.test.ts`                                                                      |
| the package's manifest                    | what it actually ships and imports                           | `test/packaging.test.ts`                                                                        |
| no two suites                             | sharing an output directory                                  | `test/isolation.test.ts`                                                                        |

## Not yet built

Named here so their absence is deliberate rather than forgotten. Each arrives with the stage that
produces the artefact it grades.

- `mcp.gen.ts` against the TypeScript compiler, corpus-wide.
- `inputSchema` against the parameters and request body `@typespec/openapi3` publishes.
- `outputSchema` against the document's success response body.
- The derived annotations against IANA's HTTP Method Registry.
- The handler signatures against a generated HTTP server's, compiled as one object through both.
- The published `tools/list` payload against a budget decomposed by source.
- Wire openness against the tool's actual behaviour.
