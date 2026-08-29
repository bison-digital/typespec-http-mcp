# Architecture

What each module owns, and the boundaries `test/architecture/architecture.test.ts` pins.

## Layers

```
                        lib.ts          options schema, diagnostics, PACKAGE_NAME
                          |
  DERIVE (read the program)          RENDER (produce text)        CONSUMER (copied out)
    select.ts    tags -> tools          tools.ts                    runtime.ts
    security.ts  auth -> requirements     |                           ToolDeps, toolResult,
    refusals.ts  what cannot be a tool    |                           statusOf, armFor,
    names.ts     ids -> tool names        |                           ResponseArm
    annotations.ts verb -> hints          |
    coexistence.ts peers -> collisions    |
                          \               /
                           emitter.ts  orchestrates, reports, writes
```

| module           | owns                                                          | may reach                                   |
| ---------------- | ------------------------------------------------------------- | ------------------------------------------- |
| `lib.ts`         | the options schema, the diagnostics, the package name         | the compiler, the library                   |
| `select.ts`      | which operations are tools, and the route-to-operation lookup | the compiler, `@typespec/http`              |
| `security.ts`    | the document's security requirements                          | the compiler, `@typespec/http`              |
| `refusals.ts`    | what cannot be a tool, and what merely warrants a warning     | the library's types                         |
| `names.ts`       | tool names, MCP's name rule, collisions                       | **nothing**                                 |
| `annotations.ts` | the RFC 9110 hints                                            | **nothing**                                 |
| `coexistence.ts` | peer emitters writing where this one writes                   | the compiler                                |
| `tools.ts`       | the text of `mcp.gen.ts`                                      | the library's types, `zod`, the SDK's types |
| `runtime.ts`     | what emitted code imports at run time                         | **only what a consumer installs**           |
| `emitter.ts`     | orchestration: run the library, select, refuse, render, write | everything above                            |

## The three rules that are enforced rather than intended

**`runtime.ts` imports only packages a consumer installs.** It is read off disk and written verbatim
into the consumer's output, so anything it imports becomes an import in _their_ build. A build-time
package there is a broken deploy, discovered at deploy time and nowhere earlier. It also imports no
other module of this package, which is what makes copying it out lossless.

**The renderer never reaches the TypeSpec compiler.** `tools.ts` produces text. It once depended on
`@typespec/compiler` and `@typespec/http` transitively, because `security.ts` declared both a
program-reading derivation and the `JSON.stringify` that fed its output into a template. A derivation
module reads the program; the renderer writes the file; neither needs the other's dependencies.

**The package name is a literal in exactly one module.** `coexistence.ts` looks this emitter up in
the compiler's own options map by name. A second copy that drifted would find nothing and report no
collision -- a guard that stops running with nothing to say so.

## The duplication that is deliberate, and what grades it

Three things are written twice on purpose. Each is forced, each is stated, and each has an arm.

| duplicated              | why it cannot be shared                                                                                                               | what grades it                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `ResponseArm`, `armFor` | the emitted `schemas.gen.ts` imports `ResponseArm` from the runtime module, and emitted output must never import a build-time package | `test/runtime/parity.test.ts`, against the library's own                                  |
| `securityFor`           | the library does not publish one, and the sibling emitter does not export its copy                                                    | `test/agreement/agreement.test.ts`, comparing what each one WRITES at its call site       |
| `Fields`, `Produced`    | emitted as text into a file that imports nothing                                                                                      | `test/agreement/agreement.test.ts`, by compiling one handler object through both surfaces |

The first and third are permanent: they follow from emitted output being self-contained. The second
is not -- `securityFor` reads only `getAuthenticationForOperation`, so it belongs in the library both
emitters run, and moving it there would turn its arm from a proof into a control.
