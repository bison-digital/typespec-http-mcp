/**
 * What TypeSpec's compiler loads for this library.
 *
 * **There is deliberately no `$decorators` export**, here or in `typespec-http-zod`. Four once
 * existed there and every one let a spec state something `@typespec/openapi3` could not publish, so
 * the emitted validator enforced a rule no caller reading the contract could see. A decorator is not
 * a convenience; it is a second contract.
 *
 * The temptation here is sharper than it was there, because MCP has concepts HTTP does not: a tool
 * hint, a title, an icon. Every one of them is either derivable from what the document already says
 * -- `readOnlyHint` from the method's safety, `title` from `@summary` -- or is a fact no reader of
 * the document could see. Selection is by `@tag`, which openapi3 publishes, for exactly this reason.
 */
export { $lib } from "./lib.js";
