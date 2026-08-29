import type { EmitContext } from "@typespec/compiler";
import { emitHttpZod } from "typespec-http-zod";

/**
 * Where emitted output imports its runtime from, when the consumer has not substituted one.
 *
 * **Deliberately NOT `./runtime.gen.js`, which is what `typespec-hono` uses.** Both emitters run
 * `typespec-http-zod` and both may be pointed at one output directory. `emitFile` has no
 * duplicate-path detection -- measured, `@typespec/compiler@1.15.0`
 * `dist/src/core/emitter-utils.js:19-27` -- so two emitters writing one path is a silent
 * last-writer-wins whose winner is decided by the order of `emit:` in `tspconfig.yaml`. Giving this
 * package its own runtime filename means the only file the two can contest is `schemas.gen.ts`,
 * which is byte-identical under identical options.
 */
export const DEFAULT_RUNTIME_MODULE = "./mcp-runtime.gen.js";

/**
 * Run the library, then add the MCP surface beside what it wrote.
 *
 * **This file may import only `./lib.js`, the library's public API and external packages.** The same
 * rule `typespec-http-zod`'s own emitter entry point holds itself to, and for the same reason: it
 * makes "the published API is sufficient to build an emitter on" true by construction rather than by
 * assertion.
 */
export async function $onEmit(context: EmitContext): Promise<void> {
	await emitHttpZod(context, { defaultRuntimeModule: DEFAULT_RUNTIME_MODULE });
}
