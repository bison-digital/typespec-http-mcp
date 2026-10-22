# Architecture

What each module owns, and the boundaries `test/architecture/architecture.test.ts` pins.

## Layers

```
                        lib.ts          options schema, diagnostics, PACKAGE_NAME
                          |
  DERIVE (read the program)          RENDER (produce text)        CONSUMER (copied out)
    select.ts    tags -> tools          tools.ts                    runtime.ts
    refusals.ts  what cannot be a tool    |                           toolResult, armFor,
    names.ts     ids -> tool names        |                           ResponseArm, errors
    annotations.ts verb -> hints          |
    coexistence.ts peers -> collisions    |
                          \               /
                           emitter.ts  orchestrates, reports, writes
```

| module           | owns                                                                                                                      | may reach                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `lib.ts`         | the options schema, the diagnostics, the package name                                                                     | the compiler, the library                   |
| `select.ts`      | which operations are tools, and the route-to-operation lookup                                                             | the compiler, `@typespec/http`              |
| `refusals.ts`    | what cannot be a tool, and what merely warrants a warning                                                                 | the library's types                         |
| `names.ts`       | tool names, MCP's name rule, collisions                                                                                   | **nothing**                                 |
| `annotations.ts` | the RFC 9110 hints                                                                                                        | **nothing**                                 |
| `coexistence.ts` | peer emitters writing where this one writes                                                                               | the compiler                                |
| `tools.ts`       | the text of `mcp.gen.ts`, result unions included                                                                          | the library's types, `zod`, the SDK's types |
| `bodies.ts`      | what each response body is: JSON, text, bytes, unvalidated - the library's result members, with this route's schema names | the library                                 |
| `runtime.ts`     | what emitted code imports at run time                                                                                     | **only what a consumer installs**           |
| `emitter.ts`     | orchestration: run the library, select, refuse, render, write                                                             | everything above                            |

## The three rules that are enforced rather than intended

**`runtime.ts` imports only packages a consumer installs.** It is read off disk and written verbatim
into the consumer's output, so anything it imports becomes an import in _their_ build. A build-time
package there is a broken deploy, discovered at deploy time and nowhere earlier. It also imports no
other module of this package, which is what makes copying it out lossless.

**And it imports no Node builtin**, which is a separate arm because the closure that grades the
first rule cannot see one. `externalClosure` skips every `node:` specifier so that `emitter.ts` may
read the filesystem without being reported, and that exclusion is exactly wrong for the one module
copied into a Workers build: `node:fs` there is `Uncaught Error: No such module "node:fs"` unless the
consumer sets `nodejs_compat`, which this package must not oblige anybody to set. Measured -- the
plant left all ten architecture arms green and failed five socket arms.

**The socket suite is the second half of that rule, and the only one that runs anything.**
`test/socket/` bundles the documented Worker with esbuild and serves it on workerd with
`compatibility_flags: []`. A static import check says what a file mentions; workerd says what a
deployment does.

**The renderer never reaches the TypeSpec compiler.** `tools.ts` produces text. It once depended on
`@typespec/compiler` and `@typespec/http` transitively, because a derivation module also held the
`JSON.stringify` that fed its output into a template. A derivation
module reads the program; the renderer writes the file; neither needs the other's dependencies.

**The package name is a literal in exactly one module.** `coexistence.ts` looks this emitter up in
the compiler's own options map by name. A second copy that drifted would find nothing and report no
collision -- a guard that stops running with nothing to say so.

## The duplication that is deliberate, and what grades it

These are written twice on purpose. Each is forced, each is stated, and each has an arm.

| duplicated              | why it cannot be shared                                                                                     | what grades it                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `ResponseArm`, `armFor` | the runtime is copied into the consumer's output, and emitted output must never import a build-time package | `test/runtime/parity.test.ts`, against the library's own, by value and by type            |
| `Fields`, `Produced`    | emitted as text into a file that imports nothing                                                            | `test/agreement/agreement.test.ts`, by compiling one handler object through both surfaces |

Both are permanent: they follow from emitted output having to be self-contained.

**Two more were removed rather than documented.** The result unions' rules and the status-code table
were held here and in the sibling server emitter, and are now the library's `resultMembersOf`,
`statusCodesOf` and `STATUS_CODES`: each emitter renders the same members in its own spelling, and
`test/agreement/agreement.test.ts` and `test/conformance/agreement.test.ts` hold the two identical.

**A third was removed rather than documented.** `securityFor` was duplicated here because the library
published only `scopes` and `noAuth` -- two lossy projections that discard which scheme demanded what
-- so both server emitters re-read the program and rebuilt the requirements by hand.
`typespec-http-zod@0.25.0` publishes `EmittedRoute.security`, this package reads it, and the
duplicate is deleted. The arm that compared the two copies is kept, and now compares the LIBRARY's
derivation against the sibling emitter's remaining copy -- a stronger comparison than the one it
replaced.
