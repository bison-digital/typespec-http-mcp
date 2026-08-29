/**
 * What an operation is called on the MCP surface.
 *
 * **The source is the operation id the DOCUMENT publishes, and it is never re-spelled.** An
 * operation id is a contract fact; a generated second spelling of it is a name no reader of the
 * document can predict. So a name this emitter cannot carry is REFUSED rather than rewritten -- the
 * same rule the sibling emitter holds for path templates, and for the same reason: a surface that
 * works and is wrong is strictly worse than one that is absent and says so.
 */

/**
 * MCP's own rule: 1 to 128 characters of `A-Z`, `a-z`, `0-9`, `_`, `-` or `.`.
 *
 * TypeSpec permits characters this does not -- `$` reaches an operation id through a template
 * instantiation -- so this refuses for real specs rather than only in theory.
 */
const MCP_TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;

export function toolNameFor(operationId: string, prefix: string | undefined): string {
	// Prepended verbatim: the author owns the separator, because any separator this emitter chose
	// would be a spelling decision the document does not state.
	return prefix === undefined ? operationId : `${prefix}${operationId}`;
}

export function isRepresentable(name: string): boolean {
	return MCP_TOOL_NAME.test(name);
}

export interface NamedTools {
	/** Operation id to tool name, for everything that survived. */
	readonly names: ReadonlyMap<string, string>;
	/** Operation ids refused because the name is unrepresentable. */
	readonly unrepresentable: readonly { readonly operationId: string; readonly name: string }[];
	/** Tool names two operations both produced. BOTH operations are refused. */
	readonly collisions: readonly {
		readonly name: string;
		readonly first: string;
		readonly second: string;
	}[];
}

/**
 * Name every selected operation, and report what cannot be named.
 *
 * **A collision refuses BOTH operations, deliberately.** Keeping one and dropping the other would
 * make the tool surface depend on which operation the emitter happened to reach first -- a surface
 * that answers, and answers as the wrong operation.
 */
export function nameTools(selected: readonly string[], prefix: string | undefined): NamedTools {
	const names = new Map<string, string>();
	const unrepresentable: { operationId: string; name: string }[] = [];
	const byName = new Map<string, string>();
	const collisions: { name: string; first: string; second: string }[] = [];

	for (const operationId of selected) {
		const name = toolNameFor(operationId, prefix);
		if (!isRepresentable(name)) {
			unrepresentable.push({ operationId, name });
			continue;
		}
		const first = byName.get(name);
		if (first !== undefined) {
			collisions.push({ name, first, second: operationId });
			continue;
		}
		byName.set(name, operationId);
		names.set(operationId, name);
	}

	// Both sides of a collision are refused, so the winner recorded above is removed too.
	for (const collision of collisions) names.delete(collision.first);

	return { names, unrepresentable, collisions };
}
