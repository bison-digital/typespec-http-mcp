import { getDiscriminator, type Program, type Type } from "@typespec/compiler";
import type { HttpOperation } from "@typespec/http";
import type { EmittedRoute, InputLocation, RouteSchemaNames } from "typespec-http-zod";
import { unvalidatedResponsesOf } from "./bodies.js";

/**
 * What this emitter cannot express as a tool, and what it can express but should warn about.
 *
 * **The two are kept apart deliberately.** A REFUSAL removes the operation from the tool surface, so
 * it must be counted: `emitted + refused === selected` is the invariant that makes a silent drop
 * arithmetically impossible. A WARNING leaves the tool in place and says something about its quality.
 * Conflating them would let a quality complaint quietly delete a tool.
 */

/** How a `shared-input-key` refusal names where each of the two inputs comes from. */
const INPUT_LOCATION_NOUNS: Readonly<Record<InputLocation, string>> = {
	path: "path parameter",
	query: "query parameter",
	header: "header",
	cookie: "cookie",
	body: "body",
};

/** A media type a tool can actually send. `application/json`, and the `+json` structured suffix. */
function isJson(contentType: string): boolean {
	const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
	return type === "application/json" || type.endsWith("+json");
}

function isMultipart(contentType: string): boolean {
	return (contentType.split(";")[0]?.trim().toLowerCase() ?? "").startsWith("multipart/");
}

export type Refusal =
	| { readonly kind: "shared-input-key"; readonly types: string }
	| { readonly kind: "binary-tool-input"; readonly types: string }
	| { readonly kind: "non-json-request"; readonly types: string }
	| { readonly kind: "non-object-body"; readonly types: string }
	| { readonly kind: "streamed-tool-output"; readonly types: string };

/**
 * Whether a request body can be MERGED into a tool's argument object.
 *
 * **A tool's arguments are one object, and the document states the body separately from the
 * parameters, so the two are merged here.** A body that is a scalar, an enum, a union or an array
 * has no properties to merge -- `@body body: string` produces a `ZodString`, and spreading its
 * (absent) shape emits a file that does not compile. Naming it under an invented property would
 * publish a contract no reader of the document could predict, and would break the shared handler
 * signature, which takes the bare value.
 *
 * A body the library already NAMES is safe whatever its type: it is nested rather than merged.
 */
function isMergeableBody(program: Program, type: Type | undefined): boolean {
	if (type === undefined) return true;
	if (type.kind !== "Model") return false;
	// An array is a Model with an integer-keyed indexer, and has no properties to merge.
	if (type.indexer?.key?.name === "integer") return false;
	/**
	 * A model carrying `@discriminator` is emitted as a UNION of its variants and itself, not as an
	 * object -- measured: `z.union([z.discriminatedUnion("kind", [...]), z.object(...)])`, which has
	 * no shape. Which arm a value takes is decided by the value, so there is no single set of
	 * properties to merge into the arguments.
	 */
	if (getDiscriminator(program, type) !== undefined) return false;
	/**
	 * **A TYPED index signature does not survive the merge.** A model carrying declared keys beside a
	 * `Record<float32>` spreads its shape into the argument object, and the index type is left behind:
	 * the merge publishes `{ [x: string]: unknown }` where the handler declares
	 * `{ [x: string]: number }`. Measured on the corpus, that is a `TS2345` in a file the consumer
	 * cannot edit.
	 *
	 * An `unknown`-valued indexer is ordinary model openness and merges without loss, so it is not
	 * refused -- the same distinction the library draws between openness and a dictionary.
	 */
	for (let model: typeof type | undefined = type; model !== undefined; model = model.baseModel) {
		const indexer = model.indexer;
		if (indexer?.key?.name === "string" && indexer.value?.kind !== "Intrinsic") return false;
	}
	return true;
}

/**
 * Why this operation cannot be a tool, or `undefined` where it can.
 *
 * **Not a refusal: a reserved-expansion path parameter.** That is a ROUTING fact -- it decides how a
 * router matches a URL. MCP has no URI template, and the handler receives the same string either
 * way. The sibling server emitter refuses it and should; that the two emitters have different
 * refusal sets from one intermediate representation is by design, not a gap.
 */
export function refusalFor(
	program: Program,
	route: EmittedRoute,
	operation: HttpOperation,
): Refusal | undefined {
	const types = route.requestContentTypes;

	/**
	 * **Two inputs under one key cannot both be arguments.** A tool's arguments are the parameter
	 * groups spread into one object, as a server's handler input is, so `@header("x")` beside
	 * `@query("x")` published one `x` whose later schema replaced the earlier, and the handler was
	 * handed one value for two declarations. The library names every such pair; the operation is not
	 * a tool, for the reason `typespec-hono` does not mount it.
	 */
	if (route.sharedInputKeys.length > 0) {
		return {
			kind: "shared-input-key",
			types: route.sharedInputKeys
				.map(
					(shared) =>
						`the ${INPUT_LOCATION_NOUNS[shared.first]} '${shared.key}' and the ${INPUT_LOCATION_NOUNS[shared.second]} '${shared.key}'`,
				)
				.join("; "),
		};
	}

	/**
	 * A raw body is bytes or a stream; a multipart body is parts, one of which is usually a file.
	 * Neither is a JSON value, and encoding one into a string argument would put an upload through a
	 * model's context window under a contract the document never stated.
	 *
	 * **A raw body that is TEXT under no JSON type is not this:** a model declared only as XML is
	 * handed to a server as the text that arrived, and what MCP cannot carry about it is the media
	 * type, which the next check names. Text under a JSON type - a `bytes` body a signature covers -
	 * stays here, as it always has.
	 */
	if (route.rawBodyProperty !== undefined && (route.rawBodyBinary || types.some(isJson))) {
		return {
			kind: "binary-tool-input",
			types: types.length === 0 ? "a raw body" : types.join(", "),
		};
	}
	if (types.some(isMultipart)) {
		return { kind: "binary-tool-input", types: types.join(", ") };
	}

	/**
	 * Only where NO JSON type is declared beside them. Where one is, the tool sends JSON and the
	 * others are simply unreachable from MCP, which is not a defect.
	 */
	if (types.length > 0 && !types.some(isJson)) {
		return { kind: "non-json-request", types: types.join(", ") };
	}

	/**
	 * A body the library named is nested under that name and is safe whatever its type. An unnamed
	 * body is merged into the argument object, so it must have properties to merge.
	 */
	if (route.bodyProperty === undefined) {
		/**
		 * **A body declared `void` is no body**, and the library lists no media type for one; read
		 * that way, there is nothing to merge. Read off the operation, its intrinsic type is not an
		 * object and the tool was refused as `non-object-body`. A body declared `never` the library
		 * refuses, as `never-body`.
		 */
		const body = types.length === 0 ? undefined : operation.parameters.body?.type;
		if (!isMergeableBody(program, body)) {
			return { kind: "non-object-body", types: body?.kind ?? "unknown" };
		}
	}

	/**
	 * **A stream is not one message, and a tool result is.** An SSE or JSONL response is unbounded and
	 * arrives over time; a tool call answers once. Buffering it would wait on a stream that may never
	 * end, and answering its first event would publish a contract no reader of the document could
	 * predict.
	 */
	const streamed = route.responses.filter((response) => response.streamed);
	if (streamed.length > 0) {
		return {
			kind: "streamed-tool-output",
			types: streamed.flatMap((response) => response.contentTypes).join(", ") || "a stream",
		};
	}
	return undefined;
}

/** A quality warning, with what its message names. */
export type Warning =
	| { readonly code: "headers-only-success" | "tool-without-description"; readonly format: object }
	| {
			readonly code: "unvalidated-response-media-type";
			readonly format: { readonly status: string; readonly types: string };
	  };

/**
 * Quality warnings: the tool is still emitted.
 *
 * `headers-only-success` fires where a 2xx or 3xx response carries headers and no body, so everything
 * that response produces lands in `_meta` -- which a model does not read. Read off each declared
 * response, ranges included, because a `2XX` with a header and no body answers the same way.
 *
 * `unvalidated-response-media-type` fires once per status whose body under some media type is a model
 * no serialisation derives from -- an `Item` as `application/xml`. The handler supplies that text and
 * the tool answers it unvalidated. The sibling server emitter raises the same warning, under the same
 * code, for the same responses.
 */
export function warningsFor(
	route: EmittedRoute,
	names: RouteSchemaNames,
	described: boolean,
): readonly Warning[] {
	const warnings: Warning[] = [];
	const headersOnlySuccess = route.responses.some(
		(response) =>
			isSuccess(response.status) && response.schema === undefined && response.headers.length > 0,
	);
	if (headersOnlySuccess) warnings.push({ code: "headers-only-success", format: {} });
	for (const { status, types } of unvalidatedResponsesOf(route, names)) {
		warnings.push({
			code: "unvalidated-response-media-type",
			format: { status: String(status), types: types.join(", ") },
		});
	}
	if (!described) warnings.push({ code: "tool-without-description", format: {} });
	return warnings;
}

/** A 2xx or 3xx status key, exact or ranged. */
function isSuccess(status: EmittedRoute["responses"][number]["status"]): boolean {
	if (typeof status === "number") return status >= 200 && status < 400;
	return status === "2XX" || status === "3XX";
}
