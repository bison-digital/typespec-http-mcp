import {
	type CallableMessage,
	createTypeSpecLibrary,
	type DiagnosticReport,
	type JSONSchemaType,
	paramMessage,
	type Program,
	type TypeSpecLibrary,
} from "@typespec/compiler";
import {
	EmitterOptionsSchema as httpZodOptions,
	type EmitterOptions as HttpZodOptions,
} from "typespec-http-zod";

/**
 * Everything `typespec-http-zod` accepts, plus what an MCP tool surface needs on top.
 *
 * **DERIVED, never restated, and the distinction is load-bearing.** This emitter runs the whole of
 * `typespec-http-zod` and adds files beside its output; every option that package accepts has to
 * reach it. Written as a second literal list, an option added there would be rejected here as
 * unknown, or worse, accepted and silently dropped -- output that is wrong in a way no test of
 * either package would see. `test/options.test.ts` asserts the forwarding as a CLASS.
 */
export type EmitterOptions = HttpZodOptions & {
	/**
	 * Tags that mark an operation as a tool. Unset means every operation is one.
	 *
	 * **Union, not intersection.** OpenAPI tags are a flat set with no AND semantics, so "carries any
	 * of these" is the only reading the published document supports. Read with `getAllTags`, which
	 * includes tags inherited from the enclosing interface and namespace -- `getTags` returns only an
	 * operation's own, so an operation inside a `@tag`-carrying interface would report none and be
	 * silently dropped.
	 */
	"tool-tags"?: string[];
	/** Tags that exclude an operation from the tool surface, even when `tool-tags` selected it. */
	"exclude-tags"?: string[];
	/**
	 * Prepended to every tool name, verbatim -- the author owns the separator.
	 *
	 * The result is validated against MCP's name rule and REFUSED if it fails, never rewritten: an
	 * operation id is a fact the document publishes, and re-spelling it invents a second name for
	 * one thing.
	 */
	"tool-prefix"?: string;
	/**
	 * Per-service overrides this emitter adds on top of the library's.
	 *
	 * **The library's own `services` map is preserved**, because the type is an intersection: an
	 * option added there still arrives here, and this only widens what each entry may carry.
	 */
	services?: Record<
		string,
		{
			"emit-tools"?: boolean;
			"tool-tags"?: string[];
			"exclude-tags"?: string[];
			"tool-prefix"?: string;
		}
	>;
};

const toolSelection = {
	"tool-tags": { type: "array", items: { type: "string" }, nullable: true },
	"exclude-tags": { type: "array", items: { type: "string" }, nullable: true },
	"tool-prefix": { type: "string", nullable: true },
};

/**
 * **A spread of the published schema, so a new key arrives for free.**
 *
 * `properties` is spread rather than re-listed for the same reason the type is aliased rather than
 * re-declared. The MCP-only keys are added to that spread, never by copying the library's list.
 */
/**
 * The published schema, narrowed to the object variant it actually is.
 *
 * **`JSONSchemaType<T>` is a UNION of variants** -- an object schema, an `anyOf`, and others --
 * and spreading a union-typed value yields a union, which then matches no single target. The value
 * `typespec-http-zod` publishes is the object variant (measured: its runtime keys are `type`,
 * `additionalProperties`, `properties`, `required`, with `type === "object"`). Narrowing once here
 * is what keeps the four spreads below honest rather than casting at each of them, and
 * `test/options.test.ts` grades the RESULT as a class, so a narrowing that ever became untrue would
 * surface as a missing option rather than as a silent type hole.
 */
const httpZodObject = httpZodOptions as Extract<typeof httpZodOptions, { type: "object" }>;

const EmitterOptionsSchema = {
	...httpZodObject,
	properties: {
		...httpZodObject.properties,
		...toolSelection,
		/**
		 * **Spread from the library's own entry rather than restated**, so a per-service option added
		 * there still validates here.
		 */
		services: {
			...(httpZodObject.properties as { services: Record<string, unknown> }).services,
			additionalProperties: {
				type: "object",
				additionalProperties: false,
				properties: {
					...(
						httpZodObject.properties as {
							services: { additionalProperties: { properties: Record<string, unknown> } };
						}
					).services.additionalProperties.properties,
					...toolSelection,
					"emit-tools": { type: "boolean", nullable: true },
				},
				required: [],
			},
		},
	},
	/**
	 * **Asserted, and the assertion is graded rather than trusted.**
	 *
	 * The spread above carries the whole published schema, which is what keeps a new library option
	 * arriving here for free. It also carries `dependencies`, `dependentRequired` and
	 * `dependentSchemas`, whose TYPES are written over `keyof HttpZodOptions`. This emitter's option
	 * type adds three keys the library does not have, so those families no longer match under
	 * `exactOptionalPropertyTypes` -- `TS2375`. None of them is present at run time (measured: the
	 * published object's only keys are `type`, `additionalProperties`, `properties` and `required`)
	 * and this schema uses none of them.
	 *
	 * `typespec-hono` does not hit this because the only key it adds, `services`, the library already
	 * has, so its key set is identical.
	 *
	 * **What stops this hiding a real defect is `test/options.test.ts`**, which asserts as a CLASS
	 * that every option the library publishes appears here, top level and per service. A spread that
	 * silently stopped forwarding would fail there, where a type error would no longer.
	 */
} as unknown as JSONSchemaType<EmitterOptions>;

/**
 * What this emitter refuses that the library does not.
 *
 * The library refuses what no OpenAPI document can state. Everything here is narrower: what no MCP
 * TOOL can express. Two different questions, and keeping them in separate libraries is what stops a
 * consumer who wants validators without a tool surface inheriting a refusal about tools.
 *
 * **All warnings, never errors.** A TypeSpec `error` sets `program.hasError()`, and
 * `@typespec/openapi3` then writes nothing -- so an error here would cost the consumer their whole
 * document over one operation this emitter happens not to like.
 */
const diagnostics = {
	/**
	 * The selection matched nothing, for any reason: a typo in `tool-tags`, an `exclude-tags` that
	 * swallowed everything, an explicit empty list.
	 *
	 * The message names the tags the service ACTUALLY declares alongside the ones configured, because
	 * that is the cheap half of the fix and the emitter already has it.
	 */
	"no-tools-selected": {
		severity: "warning",
		messages: {
			default: paramMessage`No operation in '${"service"}' was selected as a tool. Configured tool-tags: ${"configured"}. Tags this service declares: ${"available"}. Adjust 'tool-tags' or 'exclude-tags', or remove them to select every operation.`,
		},
	},
	/**
	 * A tool name MCP cannot carry.
	 *
	 * Refused rather than rewritten. An operation id is a contract fact the document publishes; a
	 * generated second spelling of it is a name no reader of the document can predict. TypeSpec
	 * permits characters MCP's rule does not, so this fires for real specs rather than only in theory.
	 */
	"unrepresentable-tool-name": {
		severity: "warning",
		messages: {
			default: paramMessage`'${"name"}' is not a name MCP can carry: a tool name is 1 to 128 characters of A-Z, a-z, 0-9, '_', '-' or '.'. Name the operation with '@operationId("...")', or shorten 'tool-prefix'. This emitter will not re-spell a published operation id.`,
		},
	},
	/**
	 * A request body an MCP tool argument cannot carry.
	 *
	 * A tool's arguments are JSON. A raw `bytes` body, a stream, or a `multipart/form-data` upload is
	 * not JSON and cannot become one without inventing an encoding the document never states.
	 * **Refused rather than approximated**: base64-ing a body into a string argument would publish a
	 * contract no reader of the document could predict, and would put a whole upload through a model's
	 * context window.
	 */
	"binary-tool-input": {
		severity: "warning",
		messages: {
			default: paramMessage`'${"operationId"}' takes a binary or multipart request body (${"types"}), which an MCP tool argument cannot carry: tool arguments are JSON. Exclude it with 'exclude-tags', or declare a JSON-bodied operation for the tool surface.`,
		},
	},
	/**
	 * Every declared request media type is one a tool cannot send.
	 *
	 * Fires only where NO JSON media type is declared beside them. Where one is, the tool sends JSON
	 * and the others are simply unreachable from MCP, which is not a defect worth a diagnostic.
	 */
	"non-json-request": {
		severity: "warning",
		messages: {
			default: paramMessage`'${"operationId"}' declares only non-JSON request media types (${"types"}), and an MCP tool sends JSON. Declare 'application/json' alongside them.`,
		},
	},
	/**
	 * A success that carries headers and no body.
	 *
	 * The tool would return nothing a model can read: response headers go to `_meta`, which a model
	 * does not see. **Not a refusal** -- the tool is still emitted, because the operation is callable
	 * and its effect may be the point. It is a warning because the value is invisible where it
	 * matters.
	 */
	"headers-only-success": {
		severity: "warning",
		messages: {
			default: paramMessage`'${"operationId"}' answers with response headers and no body, so its tool returns nothing a model can read: headers are carried in '_meta', which a model does not see. Declare the value in the response body.`,
		},
	},
	/**
	 * A selected operation with nothing for a model to read.
	 *
	 * A model chooses a tool by its description. Fires only for SELECTED operations: an opinion about
	 * an operation that is not a tool is not this emitter's business.
	 */
	"tool-without-description": {
		severity: "warning",
		messages: {
			default: paramMessage`'${"operationId"}' becomes a tool with no description. A model chooses tools by their description, so an undescribed one is unlikely to be called correctly. Add a doc comment, or '@summary'.`,
		},
	},
	/**
	 * Two selected operations produce one tool name.
	 *
	 * **BOTH are refused, and that is deliberate.** Keeping one and dropping the other would make the
	 * tool surface depend on which operation the emitter happened to reach first -- a surface that
	 * works and is wrong, which is strictly worse than one that is absent and says so.
	 */
	"tool-name-collision": {
		severity: "warning",
		messages: {
			default: paramMessage`'${"first"}' and '${"second"}' both produce the tool name '${"name"}', so neither is emitted. Give one of them an '@operationId', or set a per-service 'tool-prefix'.`,
		},
	},
} as const;

/**
 * **Spelled out rather than inferred, and every type in it imported through THIS package's own
 * specifier.** Both this package and `typespec-http-zod` declare `@typespec/compiler` as a peer, so a
 * side-by-side checkout resolves two physically distinct copies of the identical version. TypeScript
 * then has a choice of which copy to name in the emitted declarations, and naming the other
 * package's produces `TS2883`, whose message is exactly the problem: *"this is likely not portable"*.
 *
 * A published `.d.ts` naming a `node_modules/.pnpm/...` path is broken for everyone who installed
 * differently. **A consumer never hits this**, because a peer dependency is installed once and both
 * packages share it -- which is precisely why it is worth guarding rather than trusting: the failure
 * exists only in the arrangement that BUILDS the package, and would ship silently.
 */
type Diagnostics = {
	"no-tools-selected": {
		readonly default: CallableMessage<["service", "configured", "available"]>;
	};
	"unrepresentable-tool-name": { readonly default: CallableMessage<["name"]> };
	"tool-name-collision": { readonly default: CallableMessage<["first", "second", "name"]> };
	"binary-tool-input": { readonly default: CallableMessage<["operationId", "types"]> };
	"non-json-request": { readonly default: CallableMessage<["operationId", "types"]> };
	"headers-only-success": { readonly default: CallableMessage<["operationId"]> };
	"tool-without-description": { readonly default: CallableMessage<["operationId"]> };
};

export const $lib: TypeSpecLibrary<Diagnostics, EmitterOptions> = createTypeSpecLibrary({
	name: "typespec-http-mcp",
	diagnostics,
	emitter: { options: EmitterOptionsSchema },
});

export const reportDiagnostic: <C extends keyof Diagnostics, M extends keyof Diagnostics[C]>(
	program: Program,
	diagnostic: DiagnosticReport<Diagnostics, C, M>,
) => void = $lib.reportDiagnostic;
export { EmitterOptionsSchema };
