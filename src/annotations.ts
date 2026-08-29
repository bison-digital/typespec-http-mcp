/**
 * The MCP tool hints, derived from the method's own semantics.
 *
 * **Every value here comes from RFC 9110, and the oracle that grades it is IANA's HTTP Method
 * Registry** -- a table a third party publishes, not the one below. An arm that recomputed
 * `verb in {GET, HEAD}` from this same map would agree with any mistake it contains.
 *
 * | hint | source |
 * | --- | --- |
 * | `readOnlyHint` | RFC 9110 s9.2.1, safe methods |
 * | `idempotentHint` | RFC 9110 s9.2.2, idempotent methods |
 * | `destructiveHint` | no external source; see below |
 * | `openWorldHint` | not derivable, never written |
 */

/** Safe methods: RFC 9110 s9.2.1. A safe method is also idempotent, s9.2.2. */
const SAFE = new Set(["get", "head"]);

/** Idempotent methods: RFC 9110 s9.2.2. */
const IDEMPOTENT = new Set(["get", "head", "put", "delete"]);

export interface ToolAnnotations {
	readonly readOnlyHint?: boolean;
	readonly idempotentHint?: boolean;
	readonly destructiveHint?: boolean;
}

/**
 * What this emitter states about a method, and what it deliberately leaves unsaid.
 *
 * - `readOnlyHint: true` for a safe method. **`false` is never written**: it is MCP's default, so
 *   writing it says nothing while implying the emitter knows something it does not.
 * - `idempotentHint` is written in BOTH directions, because the document's method makes both
 *   derivable. POST and PATCH are explicitly not idempotent, and saying so is a fact rather than a
 *   guess.
 * - `destructiveHint: true` for DELETE only. **Omitted for POST and PATCH**, where MCP's default of
 *   `true` stands: the document gives no basis to contradict it, and an emitter must not invent one.
 * - `openWorldHint` is never written. Whether an operation reaches beyond this service is not
 *   something any OpenAPI keyword states.
 */
export function annotationsFor(verb: string): ToolAnnotations {
	const method = verb.toLowerCase();
	const annotations: {
		readOnlyHint?: boolean;
		idempotentHint?: boolean;
		destructiveHint?: boolean;
	} = {};
	if (SAFE.has(method)) annotations.readOnlyHint = true;
	annotations.idempotentHint = IDEMPOTENT.has(method);
	if (method === "delete") annotations.destructiveHint = true;
	return annotations;
}
