import { type EmittedRoute, objectKey, type RouteSchemaNames } from "typespec-http-zod";
import { annotationsFor, type ToolAnnotations } from "./annotations.js";
import type { SecurityRequirement } from "./runtime.js";

/**
 * **Rendering lives here, with everything else that produces text.**
 *
 * These two were declared beside the derivations that feed them, which read them straight into a
 * template. That put a compiler-reading module on the renderer's import path for the sake of a
 * `JSON.stringify`, so `tools.ts` -- which produces nothing but text -- transitively depended on
 * `@typespec/compiler` and `@typespec/http`. A derivation module reads the program; this one writes
 * the file; neither needs the other's dependencies.
 */

/** The requirements as a TypeScript literal, for the generated call site. */
function renderSecurity(requirements: readonly SecurityRequirement[]): string {
	return `[${requirements
		.map(
			(requirement) =>
				`{ ${Object.entries(requirement)
					.map(
						([scheme, scopes]) =>
							`${JSON.stringify(scheme)}: [${scopes.map((s) => JSON.stringify(s)).join(", ")}]`,
					)
					.join(", ")} }`,
		)
		.join(", ")}]`;
}

/** The annotations as a TypeScript object literal, for the generated call site. */
function renderAnnotations(annotations: ToolAnnotations): string {
	const entries = Object.entries(annotations).map(([key, value]) => `${key}: ${String(value)}`);
	return `{ ${entries.join(", ")} }`;
}

/** The two helper types the generated signatures need, byte-identical to the sibling emitter's. */
const HELPERS = `/**
 * A validator's fields, or nothing at all when it declares none.
 *
 * **Zod 4 infers \`Record<string, never>\` for \`z.object({})\`.** That is a fair reading on its own -
 * no string key may exist - and lethal in an intersection: \`{ id: string } & Record<string, never>\`
 * makes \`id\` into \`string & never\`, so the input type is uninhabitable and the call site below
 * cannot compile. An empty model contributes nothing to an operation's input, and \`unknown\` is the
 * identity of \`&\`, so that is what it becomes.
 */
type Fields<T> = string extends keyof T ? ([T[string]] extends [never] ? unknown : T) : T;

/**
 * What a handler must SUPPLY, as opposed to what it receives.
 *
 * An index signature and \`readonly\` are true of an inferred type without being obligations on a
 * producer, so both are dropped here - only where the shape has declared keys beside it, because an
 * index signature also arrives as a property's own declared type, where stripping it would destroy
 * the property. An explicit \`| undefined\` on an optional property is deliberately NOT removed:
 * dropping an index signature makes MORE values assignable, and removing \`| undefined\` makes fewer.
 */
type ProducedKeyOf<T> = keyof {
	[K in keyof T as string extends K
		? never
		: number extends K
			? never
			: symbol extends K
				? never
				: K]: 0;
};

type Produced<T> = T extends (...args: never[]) => unknown
	? T
	: T extends readonly (infer Element)[]
		? readonly Produced<Element>[]
		: T extends object
			? [ProducedKeyOf<T>] extends [never]
				? { readonly [K in keyof T]: Produced<T[K]> }
				: {
						readonly [K in keyof T as string extends K
							? never
							: number extends K
								? never
								: symbol extends K
									? never
									: K]: Produced<T[K]>;
					}
			: T;
`;

const EMPTY_INPUT = "Record<string, never>";

export interface ToolEntry {
	readonly route: EmittedRoute;
	readonly names: RouteSchemaNames;
	readonly toolName: string;
	readonly requirements: readonly SecurityRequirement[];
	readonly description: string | undefined;
	readonly title: string | undefined;
}

/**
 * The validators that INTERSECT into the handler's input.
 *
 * A body the document says must not be flattened is NAMED rather than intersected: its index
 * signature would otherwise be imposed on every sibling, so an optional query parameter beside a
 * dictionary body would not compile. The document states the parameters and the body separately.
 */
function intersectedValidators(entry: ToolEntry): readonly string[] {
	const { names, route } = entry;
	const groups = [names.path, names.query, names.header, names.body];
	return groups.filter(
		(name): name is string =>
			name !== undefined && (route.bodyProperty === undefined || name !== names.body),
	);
}

/** The handler's input type: the same intersection the sibling server emitter writes. */
function inputTypeOf(entry: ToolEntry): string {
	const parts = intersectedValidators(entry).map((name) => `Fields<z.infer<typeof ${name}>>`);
	if (entry.route.bodyProperty !== undefined && entry.names.body !== undefined) {
		const optionalMark = entry.route.optionalBody ? "?" : "";
		const optionalValue = entry.route.optionalBody ? " | undefined" : "";
		parts.push(
			`{ ${objectKey(entry.route.bodyProperty)}${optionalMark}: z.infer<typeof ${entry.names.body}>${optionalValue} }`,
		);
	}
	return parts.length === 0 ? EMPTY_INPUT : parts.join(" & ");
}

/**
 * The tool's ARGUMENT schema: every group the document declares, merged into one object.
 *
 * **Merged here and nowhere else.** A tool takes one flat argument object; the document states the
 * path, query, header and body separately, and the library declares them separately. Merging is
 * this emitter's job.
 *
 * **Openness follows `seal-object-schemas`**, the same option every other emitted object follows.
 * There is no merged schema in the published document, so the document has no opinion on whether
 * the merge admits extra keys, and an emitter must not invent one.
 *
 * **A parameterless operation is SEALED**, which is what the MCP specification recommends and which
 * mirrors the handler's own declared input: `Record<string, never>` for an operation with no
 * parameters, and open otherwise.
 */
function inputSchemaOf(entry: ToolEntry, sealed: boolean): string {
	const constructor = sealed ? "z.strictObject" : "z.looseObject";
	const spreads = intersectedValidators(entry).map((name) => `...${name}.shape`);
	if (entry.route.bodyProperty !== undefined && entry.names.body !== undefined) {
		spreads.push(`${objectKey(entry.route.bodyProperty)}: ${entry.names.body}`);
	}
	if (spreads.length === 0) return "z.strictObject({})";
	return `${constructor}({ ${spreads.join(", ")} })`;
}

/** The handler's return type: the body a producer must supply, plus the envelope it must state. */
function outputTypeOf(entry: ToolEntry): string {
	return entry.names.response === undefined
		? "void"
		: `Produced<z.infer<typeof ${entry.names.response}>>`;
}

function inputSchemaName(entry: ToolEntry): string {
	return `${entry.route.operationId}Input`;
}

/** The banner every generated file in this estate carries. */
function generatedBanner(hint: string | undefined): string {
	const second =
		hint === undefined
			? "// Recompile the spec that produced it; edits here are overwritten on the next run."
			: `// Regenerate with: ${hint}`;
	return `// GENERATED by typespec-http-mcp from the TypeSpec service definition. DO NOT EDIT.\n${second}\n`;
}

export interface RenderedTools {
	readonly text: string;
	/** Operation ids that became tools. */
	readonly emitted: readonly string[];
}

export function renderTools(
	entries: readonly ToolEntry[],
	declaredOperationIds: readonly string[],
	options: {
		readonly runtimeModule: string;
		readonly sealed: boolean;
		readonly hint: string | undefined;
	},
): RenderedTools {
	const imported = new Set<string>();
	for (const entry of entries) {
		for (const name of intersectedValidators(entry)) imported.add(name);
		if (entry.names.body !== undefined) imported.add(entry.names.body);
		if (entry.names.response !== undefined) imported.add(entry.names.response);
		imported.add(entry.names.responses);
	}

	const runtimeImport = `import type { Awaitable, Ctx, McpServer, Result, ServerContext, ToolDeps } from ${JSON.stringify(options.runtimeModule)};`;
	const schemaImport =
		imported.size === 0
			? ""
			: `import { ${[...imported].toSorted().join(", ")} } from "./schemas.gen.js";\n`;

	const inputConsts = entries
		.map((entry) => `const ${inputSchemaName(entry)} = ${inputSchemaOf(entry, options.sealed)};`)
		.join("\n");

	const methods = entries
		.map((entry) => {
			const doc = entry.description === undefined ? "" : `\t/** ${entry.description} */\n`;
			return `${doc}\t${entry.route.operationId}(ctx: Ctx, input: ${inputTypeOf(entry)}): Awaitable<Result<${outputTypeOf(entry)}>>;`;
		})
		.join("\n");

	const declaredUnion =
		declaredOperationIds.length === 0
			? "never"
			: declaredOperationIds.map((id) => JSON.stringify(id)).join(" | ");

	/**
	 * **Registered in a deterministic order, sorted by tool name.**
	 *
	 * The MCP specification says a server SHOULD return tools in a deterministic order: it lets a
	 * client cache the list, and it improves prompt-cache hit rates when the tools are put in a
	 * model's context. Route order is not stable across spec edits; a name sort is.
	 */
	const ordered = [...entries].toSorted((a, b) => a.toolName.localeCompare(b.toolName));

	const registrations = ordered
		.map((entry) => {
			const title =
				entry.title === undefined ? "" : `\n\t\t\t\ttitle: ${JSON.stringify(entry.title)},`;
			const description =
				entry.description === undefined
					? ""
					: `\n\t\t\t\tdescription: ${JSON.stringify(entry.description)},`;
			const outputSchema =
				entry.names.response === undefined
					? ""
					: `\n\t\t\t\toutputSchema: ${entry.names.response},`;
			const declared = `{ arms: ${entry.names.responses}, outputSchema: ${entry.names.response ?? "undefined"} }`;
			/**
			 * **A parameterless tool must not DECLARE an argument it never reads.**
			 *
			 * `noUnusedParameters` is an error in the settings a consumer builds with, so `async (args,
			 * ...)` on an operation with no parameters is `TS6133` in a file they cannot edit. The
			 * callback still receives the argument; it is named `_args` so the compiler knows the
			 * omission is deliberate.
			 */
			const parameterless =
				intersectedValidators(entry).length === 0 && entry.route.bodyProperty === undefined;
			const argument = parameterless ? "{}" : "{ ...args }";
			const argumentName = parameterless ? "_args" : "args";
			return `	if (deps.permits(${renderSecurity(entry.requirements)})) {
		server.registerTool(
			${JSON.stringify(entry.toolName)},
			{${title}${description}
				inputSchema: ${inputSchemaName(entry)},${outputSchema}
				annotations: ${renderAnnotations(annotationsFor(entry.route.verb))},
			},
			async (${argumentName}, context) => {
				const ctx = deps.context(context, ${entry.route.noAuth ? '"none"' : '"required"'});
				if (ctx === null) return deps.noContext(context);
				return deps.respond(
					context,
					${declared},
					await handlersFor(context).${entry.route.operationId}(ctx, ${argument}),
				);
			},
		);
		registered.push(${JSON.stringify(entry.toolName)});
	}`;
		})
		.join("\n");

	const text = `${generatedBanner(options.hint)}
import { z } from "zod";
${runtimeImport}
${schemaImport}
${HELPERS}
${inputConsts}

/**
 * One method per TOOL, each concretely typed from the schemas it validates against.
 *
 * **These are the same signatures a generated HTTP server emits for the same operations**, derived
 * from the same artefacts by the same rules, so ONE handler implementation serves both surfaces.
 */
export interface Tools {
${methods}
}

/**
 * Every operation the SERVICE declares, whether or not it became a tool.
 *
 * **Not \`keyof Tools\`, and the difference is the whole reason this exists.** A tool set is a
 * selected SUBSET, and an application passes the same handler object to both surfaces, so a handler
 * for a non-tool operation is expected rather than surplus. Excluding against this union instead
 * keeps the removal guard exact: a key naming no declared operation is still \`never\`.
 */
export type DeclaredOperationId = ${declaredUnion};

/**
 * Refuses a handler set carrying an operation the spec no longer declares.
 *
 * Removal is the change the type system otherwise misses: adding an operation is a missing property
 * and changing one is a wrong signature, but removing one leaves a handler that compiles forever
 * against a tool nobody registers. The excess-property check catches it only on an object literal
 * assigned to an annotated target, so mapping every surplus key to \`never\` makes the refusal
 * structural instead.
 *
 * **Write the handler factory UNANNOTATED.** Annotating widens the value, \`T\` infers as the
 * annotation, \`Exclude<keyof T, DeclaredOperationId>\` becomes \`never\`, and this guard evaporates.
 */
export type ToolsExhaustive<T> = T & Record<Exclude<keyof T, DeclaredOperationId>, never>;

/** Every tool this file registers, in the order it registers them. */
export const TOOL_NAMES = [${ordered.map((entry) => JSON.stringify(entry.toolName)).join(", ")}] as const;

/**
 * Register every tool this service declares, onto a server the APPLICATION owns.
 *
 * **The server is passed in, never constructed here.** The application owns the transport, the
 * session lifetime and the authentication that precedes both; this file owns the tool definitions
 * and the dispatch into handlers, and nothing else.
 *
 * **\`deps.permits\` is consulted at REGISTRATION, not at call time**, because the MCP specification
 * says a tool set may vary by the authorisation presented on the request. A caller does not see a
 * tool they cannot call. Returns the names actually registered, which is the only way an application
 * can observe a grant that selected nothing.
 */
export function registerTools<T extends Tools>(
	server: McpServer,
	handlersFor: (context: ServerContext) => ToolsExhaustive<T>,
	deps: ToolDeps,
): readonly string[] {
	const registered: string[] = [];
${registrations}
	return registered;
}
`;

	return { text, emitted: entries.map((entry) => entry.route.operationId) };
}
