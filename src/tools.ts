import {
	jsDocComment,
	objectKey,
	type EmittedResponse,
	type EmittedRoute,
	type RouteSchemaNames,
} from "typespec-http-zod";
import { annotationsFor, type ToolAnnotations } from "./annotations.js";
import { bodyKindsOf, bodyServingOf, isJsonMediaType, isMediaRange, membersOf } from "./bodies.js";
import type { SecurityRequirement } from "./runtime.js";
import { CONTENTLESS_STATUS_CODES, STATUS_GROUPS } from "./statuses.js";

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

/**
 * The helper types the generated signatures need, the same types the sibling emitter declares.
 *
 * **Emitted only where a signature uses one.** A generated file has to pass the lint of whatever
 * project it lands in, and `noUnusedLocals` is an error under the settings a consumer builds with:
 * a service with no parameters anywhere never uses `Fields`, and one whose every result carries no
 * validated body never uses `Produced`. Measured across the conformance corpus, that was 29 of 65
 * emitted files failing to compile.
 */
const FIELDS_HELPER = `/**
 * A validator's fields, or nothing at all when it declares none.
 *
 * **Zod 4 infers \`Record<string, never>\` for \`z.object({})\`.** That is a fair reading on its own -
 * no string key may exist - and lethal in an intersection: \`{ id: string } & Record<string, never>\`
 * makes \`id\` into \`string & never\`, so the input type is uninhabitable and the call site below
 * cannot compile. An empty model contributes nothing to an operation's input, and \`unknown\` is the
 * identity of \`&\`, so that is what it becomes.
 */
type Fields<T> = string extends keyof T ? ([T[string]] extends [never] ? unknown : T) : T;

`;

const PRODUCED_HELPER = `/**
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

/**
 * Where emitted output imports its runtime from: the copy this package writes beside it.
 *
 * **Always this module.** `runtime-module` used to replace it, and that made an application own a
 * copy of generated logic -- see the `runtime-module-removed` diagnostic.
 *
 * **Deliberately NOT `./runtime.gen.js`, which is what the sibling server emitter uses.** Both
 * emitters run `typespec-http-zod`, and a consumer who wants both surfaces may point them at one
 * output directory. `emitFile` has no duplicate-path detection -- measured, `@typespec/compiler`
 * 1.15.0 `dist/src/core/emitter-utils.js:19-27` -- so two emitters writing one path is a silent
 * last-writer-wins whose winner is decided by the ORDER of `emit:` in `tspconfig.yaml`. Measured
 * end to end: with divergent `seal-object-schemas`, one order produced 19 unsealed objects and the
 * other 11 unsealed plus 8 sealed, exit 0 and no diagnostic either time.
 *
 * Giving this package its own runtime filename means the only file the two can contest is
 * `schemas.gen.ts`, which is byte-identical under identical options.
 */
export const DEFAULT_RUNTIME_MODULE = "./mcp-runtime.gen.js";

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

/**
 * The groups whose `.shape` the argument schema spreads: the same groups, with the query read from
 * `queryFields`.
 *
 * **A query group can be a pipe.** Where the document explodes a record or model into query keys, the
 * library's `query` validator gathers those keys back into one property before validating, and a pipe
 * has no `.shape`. A tool's arguments are already one JSON object, so there is nothing to gather: the
 * structural object the pipe validates is the schema a tool takes.
 */
function shapedValidators(entry: ToolEntry): readonly string[] {
	const { names } = entry;
	return intersectedValidators(entry).map((name) =>
		name === names.query && names.queryFields !== undefined ? names.queryFields : name,
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
	const spreads = shapedValidators(entry).map((name) => `...${name}.shape`);
	if (entry.route.bodyProperty !== undefined && entry.names.body !== undefined) {
		spreads.push(`${objectKey(entry.route.bodyProperty)}: ${entry.names.body}`);
	}
	if (spreads.length === 0) return "z.strictObject({})";
	return `${constructor}({ ${spreads.join(", ")} })`;
}

/** The codes of the status group a range key names. */
function groupCodesOf(status: `${1 | 2 | 3 | 4 | 5}XX`): readonly number[] {
	return STATUS_GROUPS[Number(status.charAt(0)) as 1 | 2 | 3 | 4 | 5].codes;
}

/**
 * The type of the `contentType` a handler names for a member: the sibling emitter's rule.
 *
 * **A range is typed as the types inside it**: `image/*` is `` `image/${string}` ``, so `text/html`
 * under it does not compile, and TypeScript still narrows a literal member away from it. Only the
 * full range is `string`.
 */
function contentTypeTypeOf(mediaType: string): string {
	if (!isMediaRange(mediaType)) return JSON.stringify(mediaType);
	if (mediaType === "*/*") return "string";
	return `\`${mediaType.slice(0, -1)}\${string}\``;
}

/**
 * A member's status as a TypeScript type: disjoint from every other member's, by construction.
 *
 * **Written as a union of literals, never as Hono's type names.** This package's output imports no
 * Hono, so where the sibling emitter writes `Exclude<ClientErrorStatusCode, 404 | ContentlessStatusCode>`
 * this writes the codes that expression resolves to, from the same sets (`statuses.ts`, held equal to
 * Hono's declaration file by test):
 *
 * - an exact code is itself;
 * - a range is its group, less every code the operation declares exactly, and less the statuses that
 *   cannot carry a body where the range has one;
 * - `default` is every official status from 2xx to 5xx, less the exact codes, less every code a
 *   declared range covers, and less the contentless statuses where it has a body.
 *
 * **Disjoint is the property that makes a wrong body a compile error**: were `default` allowed to
 * overlap a declared status, a 404 carrying the default arm's body would type-check through it.
 */
function statusTypeOf(response: EmittedResponse, route: EmittedRoute): string {
	const { status } = response;
	if (typeof status === "number") return String(status);
	const exact = new Set(
		route.responses.flatMap((candidate) =>
			typeof candidate.status === "number" ? [candidate.status] : [],
		),
	);
	const contentless = new Set<number>(
		response.schema === undefined ? [] : CONTENTLESS_STATUS_CODES,
	);
	const candidates =
		status === "default"
			? ([2, 3, 4, 5] as const).flatMap((digit) => STATUS_GROUPS[digit].codes)
			: groupCodesOf(status);
	const ranged = new Set(
		status === "default"
			? route.responses.flatMap((candidate) =>
					typeof candidate.status === "string" && candidate.status !== "default"
						? groupCodesOf(candidate.status)
						: [],
				)
			: [],
	);
	const codes = candidates
		.filter((code) => !exact.has(code) && !ranged.has(code) && !contentless.has(code))
		.toSorted((a, b) => a - b);
	return codes.length === 0 ? "never" : codes.join(" | ");
}

/**
 * The union a handler returns: `{ status, body, headers }` for every response the document declares.
 *
 * **Data rather than a transport response**, so one handler object serves this tool surface and the
 * HTTP server the sibling emitter generates, and the result type is the same type in both files.
 */
function resultTypeOf(entry: ToolEntry): string {
	const members = membersOf(entry.route, entry.names).map((member) => {
		const { response } = member;
		const fields = [`readonly status: ${statusTypeOf(response, entry.route)}`];
		if (member.choosesMediaType && member.mediaType !== undefined) {
			fields.push(`readonly contentType: ${contentTypeTypeOf(member.mediaType)}`);
		}
		switch (bodyServingOf(member)) {
			case "none":
				fields.push("readonly body?: undefined");
				break;
			case "stream":
				fields.push("readonly body: ReadableStream");
				break;
			case "binary":
				fields.push("readonly body: ReadableStream | Uint8Array<ArrayBuffer> | ArrayBuffer");
				break;
			case "unvalidated":
				fields.push("readonly body: string");
				break;
			default:
				fields.push(`readonly body: Produced<z.infer<typeof ${member.schemaName}>>`);
		}
		if (response.headers.length > 0) {
			/**
			 * Keyed by the WIRE name, as the document publishes it. `headers` itself is optional only when
			 * every header in it is, so a response declaring a required header cannot be returned without.
			 */
			const every = response.headers.every((header) => header.optional);
			const rendered = response.headers
				.map((header) =>
					header.optional
						? `readonly ${objectKey(header.name)}?: ${header.type} | undefined`
						: `readonly ${objectKey(header.name)}: ${header.type}`,
				)
				.join("; ");
			fields.push(`readonly headers${every ? "?" : ""}: { ${rendered} }`);
		}
		return `{ ${fields.join("; ")} }`;
	});
	const body =
		members.length <= 1
			? ` ${members[0] ?? "never"}`
			: members.map((member) => `\n\t| ${member}`).join("");
	return `export type ${resultTypeName(entry)} =${body};`;
}

/**
 * The published operation id with its first letter raised, and nothing else changed: the same name
 * the sibling emitter gives the same operation's result.
 */
function resultTypeName(entry: ToolEntry): string {
	const id = entry.route.operationId;
	return `${id.charAt(0).toUpperCase()}${id.slice(1)}Result`;
}

/**
 * The schema a tool publishes as its `outputSchema`, or `undefined` where it publishes none.
 *
 * **The body of the lowest exact 2xx or 3xx status**, the operation's plainest success, and only
 * where every success the document declares answers with that same body, served as JSON.
 *
 * **The second condition is MCP's, not a preference.** A tool declaring an `outputSchema` must return
 * `structuredContent` conforming to it on every result that is not an error, and the SDK client
 * enforces it: `@modelcontextprotocol/client` throws "has an output schema but did not return
 * structured content" for such a result. The runtime puts a body in `structuredContent` only when its
 * arm's schema is the published one, so an operation answering `201` with one body and `200` with
 * another, or `204` with none, would publish a schema one of its own successes cannot meet. A range
 * or `default` is never the published schema itself: neither names a status a caller can expect.
 */
function outputSchemaOf(entry: ToolEntry): string | undefined {
	const { responses } = entry.route;
	const successes = responses.flatMap((response, index) =>
		isSuccessStatus(response.status) ? [{ response, index }] : [],
	);
	const lowest = successes
		.filter((success) => typeof success.response.status === "number")
		.toSorted((a, b) => Number(a.response.status) - Number(b.response.status))[0];
	if (lowest === undefined) return undefined;
	const schema = entry.names.arms[lowest.index]?.schema;
	if (schema === undefined) return undefined;
	const servesSchemaAsJson = ({ response, index }: { response: EmittedResponse; index: number }) =>
		entry.names.arms[index]?.schema === schema &&
		!response.streamed &&
		!response.binary &&
		response.contentTypes.every(isJsonMediaType);
	return successes.every(servesSchemaAsJson) ? schema : undefined;
}

/** A 2xx or 3xx status key, exact or ranged. */
function isSuccessStatus(status: EmittedResponse["status"]): boolean {
	if (typeof status === "number") return status >= 200 && status < 400;
	return status === "2XX" || status === "3XX";
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
		readonly sealed: boolean;
		readonly hint: string | undefined;
	},
): RenderedTools {
	const imported = new Set<string>();
	for (const entry of entries) {
		for (const name of [...intersectedValidators(entry), ...shapedValidators(entry)]) {
			imported.add(name);
		}
		if (entry.names.body !== undefined) imported.add(entry.names.body);
		for (const member of membersOf(entry.route, entry.names)) {
			const serving = bodyServingOf(member);
			if ((serving === "json" || serving === "text") && member.schemaName !== undefined) {
				imported.add(member.schemaName);
			}
		}
		const outputSchema = outputSchemaOf(entry);
		if (outputSchema !== undefined) imported.add(outputSchema);
		imported.add(entry.names.responses);
	}

	/**
	 * Only the names a signature uses. `Awaitable` appears in the `Tools` properties and `toolResult`
	 * in each registration, so a service whose every operation is refused declares them and uses none
	 * -- `noUnusedLocals` is an error in the settings a consumer builds with.
	 *
	 * **Always the runtime this package writes beside the file.** It used to be whatever
	 * `runtime-module` named, which made an application own a copy of the rules below.
	 */
	const runtimeTypes = ["McpServer", "ServerContext", "ToolDeps"];
	if (entries.length > 0) runtimeTypes.push("Awaitable");
	const from = JSON.stringify(DEFAULT_RUNTIME_MODULE);
	const runtimeImport = [
		...(entries.length > 0 ? [`import { toolResult } from ${from};`] : []),
		`import type { ${runtimeTypes.toSorted().join(", ")} } from ${from};`,
	].join("\n");
	const schemaImport =
		imported.size === 0
			? ""
			: `import { ${[...imported].toSorted().join(", ")} } from "./schemas.gen.js";\n`;

	/**
	 * Which helpers any signature actually needs. Read from the IR rather than from the rendered
	 * text: deciding anything by pattern-matching emitted output is the defect class this estate
	 * exists to remove.
	 */
	const usesFields = entries.some((entry) => intersectedValidators(entry).length > 0);
	const usesProduced = entries.some((entry) =>
		membersOf(entry.route, entry.names).some((member) => {
			const serving = bodyServingOf(member);
			return serving === "json" || serving === "text";
		}),
	);
	const helpers = `${usesFields ? FIELDS_HELPER : ""}${usesProduced ? PRODUCED_HELPER : ""}`;
	/** Every tool declares an input schema, so `z` is used exactly when there is a tool. */
	const usesZod = entries.length > 0;
	/**
	 * Every parameter is unread when nothing is registered, and `noUnusedParameters` is an error in
	 * the settings a consumer builds with. The underscore says the omission is deliberate. `Tools`'
	 * caller context is unread for the same reason, and `noUnusedLocals` refuses an unused type
	 * parameter unless its name starts with one.
	 */
	const u = entries.length === 0 ? "_" : "";

	const inputConsts = entries
		.map((entry) => `const ${inputSchemaName(entry)} = ${inputSchemaOf(entry, options.sealed)};`)
		.join("\n");

	const resultTypes = entries.map(resultTypeOf).join("\n\n");

	/**
	 * **A PROPERTY signature, not a method signature, and the difference is a check.** TypeScript
	 * compares a method signature's parameters bivariantly, so a handler declaring a richer caller
	 * context than `deps.context` produces would compile against the method form.
	 */
	const methods = entries
		.map((entry) => {
			const doc = jsDocComment(entry.description, "\t");
			return `${doc}\treadonly ${objectKey(entry.route.operationId)}: (ctx: C, input: ${inputTypeOf(entry)}) => Awaitable<${resultTypeName(entry)}>;`;
		})
		.join("\n");

	/** Every scope any selected operation demands, de-duplicated and ordered. */
	const scopes = [...new Set(entries.flatMap((entry) => [...entry.route.scopes]))].toSorted();
	const scopesLiteral = `[${scopes.map((scope) => JSON.stringify(scope)).join(", ")}]`;

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
			const published = outputSchemaOf(entry);
			const outputSchema = published === undefined ? "" : `\n\t\t\t\toutputSchema: ${published},`;
			/**
			 * The body kinds the runtime cannot read off an arm, only where one applies: a JSON body is
			 * known from its media type, and most operations answer nothing else.
			 */
			const kinds = bodyKindsOf(entry.route);
			const bodies =
				kinds.length === 0
					? ""
					: `, bodies: { ${kinds.map(([status, kind]) => `${JSON.stringify(status)}: ${JSON.stringify(kind)}`).join(", ")} }`;
			const declared = `{ arms: ${entry.names.responses}, outputSchema: ${published ?? "undefined"}${bodies} }`;
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
			return `	{
		const tool = server.registerTool(
			${JSON.stringify(entry.toolName)},
			{${title}${description}
				inputSchema: ${inputSchemaName(entry)},${outputSchema}
				annotations: ${renderAnnotations(annotationsFor(entry.route.verb))},
			},
			async (${argumentName}, context) => {
				const ctx = deps.context(context, ${JSON.stringify(entry.route.authentication)});
				if (ctx === null) return deps.noContext(context);
				return toolResult(
					${declared},
					${JSON.stringify(entry.route.operationId)},
					await handlersFor(context).${entry.route.operationId}(ctx, ${argument}),
				);
			},
		);
		if (deps.permits(${renderSecurity(entry.requirements)})) {
			registered.push(${JSON.stringify(entry.toolName)});
		} else {
			tool.remove();
		}
	}`;
		})
		.join("\n");

	const text = `${generatedBanner(options.hint)}
${usesZod ? 'import { z } from "zod";\n' : ""}${runtimeImport}
${schemaImport}
${helpers}
${inputConsts}
${resultTypes === "" ? "" : `\n${resultTypes}\n`}
/**
 * One handler per TOOL, each concretely typed from the schemas it validates against, returning
 * \`{ status, body, headers }\` for any response the document declares.
 *
 * **These are the same signatures a generated HTTP server emits for the same operations**, derived
 * from the same artefacts by the same rules, so ONE handler implementation serves both surfaces.
 * \`C\` is the caller context \`deps.context\` establishes.
 */
export interface Tools<${u}C = unknown> {
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

/**
 * Every scope any selected operation demands, for the Protected Resource Metadata document.
 *
 * **The one authentication fact this emitter can state that the SDK cannot.** RFC 9728's
 * \`scopes_supported\` is what a client reads to know which scopes to ask an Authorization Server
 * for, and it is exactly the union of what the spec's \`@useAuth\` declares. Everything else about
 * authentication -- verifying a token, building the metadata document, answering a 401 with a
 * \`WWW-Authenticate\` challenge -- is the SDK's, and is not reimplemented here. Pass this to
 * \`buildOAuthProtectedResourceMetadata\`'s \`scopesSupported\`.
 *
 * Empty where the service declares no scopes, which is a fact rather than an absence: a bearer or
 * api-key scheme demands none.
 */
export const SCOPES_SUPPORTED = ${scopesLiteral} as const;

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
export function registerTools<C, T extends Tools<C>>(
	${u}server: McpServer,
	${u}handlersFor: (context: ServerContext) => ToolsExhaustive<T>,
	${u}deps: ToolDeps<C>,
): readonly string[] {
	const registered: string[] = [];
${registrations}
	return registered;
}
`;

	return { text, emitted: entries.map((entry) => entry.route.operationId) };
}
