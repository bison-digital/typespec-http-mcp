import type { EmittedRoute, RouteSchemaNames } from "typespec-http-zod";

/**
 * What this emitter cannot express as a tool, and what it can express but should warn about.
 *
 * **The two are kept apart deliberately.** A REFUSAL removes the operation from the tool surface, so
 * it must be counted: `emitted + refused === selected` is the invariant that makes a silent drop
 * arithmetically impossible. A WARNING leaves the tool in place and says something about its quality.
 * Conflating them would let a quality complaint quietly delete a tool.
 */

/** A media type a tool can actually send. `application/json`, and the `+json` structured suffix. */
function isJson(contentType: string): boolean {
	const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
	return type === "application/json" || type.endsWith("+json");
}

function isMultipart(contentType: string): boolean {
	return (contentType.split(";")[0]?.trim().toLowerCase() ?? "").startsWith("multipart/");
}

export type Refusal =
	| { readonly kind: "binary-tool-input"; readonly types: string }
	| { readonly kind: "non-json-request"; readonly types: string };

/**
 * Why this operation cannot be a tool, or `undefined` where it can.
 *
 * **Not a refusal: a reserved-expansion path parameter.** That is a ROUTING fact -- it decides how a
 * router matches a URL. MCP has no URI template, and the handler receives the same string either
 * way. The sibling server emitter refuses it and should; that the two emitters have different
 * refusal sets from one intermediate representation is the split working, not a gap.
 */
export function refusalFor(route: EmittedRoute): Refusal | undefined {
	const types = route.requestContentTypes;

	/**
	 * A raw body is bytes or a stream; a multipart body is parts, one of which is usually a file.
	 * Neither is a JSON value, and encoding one into a string argument would put an upload through a
	 * model's context window under a contract the document never stated.
	 */
	if (route.rawBodyProperty !== undefined) {
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
	return undefined;
}

/**
 * Quality warnings: the tool is still emitted.
 *
 * `headers-only-success` fires where the success arm carries headers and no body, so everything the
 * operation produces lands in `_meta` -- which a model does not read.
 */
export function warningsFor(
	route: EmittedRoute,
	names: RouteSchemaNames,
	described: boolean,
): readonly ("headers-only-success" | "tool-without-description")[] {
	const warnings: ("headers-only-success" | "tool-without-description")[] = [];
	const successStatuses = new Set(route.statusCodes.filter((status) => status < 400));
	const declaresSuccessHeaders = route.responseHeaders.some(
		(entry) =>
			typeof entry.status === "number" &&
			successStatuses.has(entry.status) &&
			entry.headers.length > 0,
	);
	if (names.response === undefined && declaresSuccessHeaders) warnings.push("headers-only-success");
	if (!described) warnings.push("tool-without-description");
	return warnings;
}
