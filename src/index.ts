/**
 * The public API.
 *
 * Re-exports `typespec-http-zod` wholesale, as `typespec-hono` does, so a consumer building on this
 * emitter has one specifier to import from rather than needing to know which package minted which
 * name.
 */
export * from "typespec-http-zod";
export { DEFAULT_RUNTIME_MODULE, $onEmit } from "./emitter.js";
export { $lib, EmitterOptionsSchema, type EmitterOptions } from "./lib.js";
