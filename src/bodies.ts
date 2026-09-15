import type { EmittedResponse, EmittedRoute, RouteSchemaNames } from "typespec-http-zod";

/**
 * **What each declared response body IS, decided once, for the renderer, the refusals and the runtime.**
 *
 * A handler's result type, the warning about a body nothing validates, the refusal of a body no tool
 * result can carry, and the body kinds the runtime is told about all read the same four facts the
 * library publishes per response: its media types, and whether its body is `binary`, `streamed` or
 * `textual`. Deciding them in one place is what keeps the result type a handler compiles against and
 * the rule the runtime serves it by from disagreeing.
 *
 * Pure: it reads the library's types and nothing else, so the renderer can use it without reaching
 * the compiler.
 */

/** A media type whose body is a JSON value. The library's own rule, and the runtime's. */
export function isJsonMediaType(type: string): boolean {
	return /^application\/(json|.*\+json)$/.test(type);
}

/** A media range such as `image/*`, rather than a type a response can be sent as. */
export function isMediaRange(mediaType: string): boolean {
	return mediaType.endsWith("/*");
}

/**
 * A media type MCP has a content block for: `image/*` and `audio/*`, which carry base64 data and
 * the media type itself. A wildcard within one is a type the handler names when it answers.
 */
export function hasContentBlock(type: string): boolean {
	return /^(image|audio)\/[^/]+$/.test(type);
}

/**
 * One thing a handler may return: a declared status, and where that status offers several media
 * types, one of them.
 *
 * **Derived by the sibling server emitter's rules, member for member**, because one handler object
 * serves both surfaces and `test/agreement/` holds the two result types identical. A status offering
 * several media types is several members, because the body differs by media type.
 */
export interface ResultMember {
	readonly response: EmittedResponse;
	/** The identifier the library declared this status's body under. */
	readonly schemaName: string | undefined;
	/** The media type served, or `undefined` where the response has no body. */
	readonly mediaType: string | undefined;
	/** Whether the handler names the media type, because the status offers more than one. */
	readonly choosesMediaType: boolean;
}

/** What a handler supplies for a member's body, which decides the body's type. */
export type BodyServing = "none" | "stream" | "binary" | "json" | "text" | "unvalidated";

export function bodyServingOf(member: ResultMember): BodyServing {
	const { response, mediaType } = member;
	if (response.schema === undefined || mediaType === undefined) return "none";
	if (response.streamed) return "stream";
	if (response.binary) return "binary";
	if (isJsonMediaType(mediaType)) return "json";
	/**
	 * **A string body under a non-JSON media type IS the text**, so it is validated and answered as is.
	 * Any other body under one -- a model as `application/xml` -- has no serialisation this emitter can
	 * derive, so the handler supplies the text and it is answered unvalidated.
	 */
	return response.textual ? "text" : "unvalidated";
}

export function membersOf(route: EmittedRoute, names: RouteSchemaNames): ResultMember[] {
	return route.responses.flatMap((response, index): ResultMember[] => {
		const schemaName = names.arms[index]?.schema;
		if (response.contentTypes.length === 0) {
			return [{ response, schemaName, mediaType: undefined, choosesMediaType: false }];
		}
		/**
		 * The handler names the media type where the status offers several, and where the document names
		 * only a wildcard range, which is not a type a response can be sent as.
		 */
		const choosesMediaType =
			response.contentTypes.length > 1 || response.contentTypes.some(isMediaRange);
		return response.contentTypes.map((mediaType) => ({
			response,
			schemaName,
			mediaType,
			choosesMediaType,
		}));
	});
}

/**
 * How the runtime answers a status's body under a media type that is not JSON, where that is not the
 * unvalidated text a handler supplies.
 *
 * - `"text"`: a string body, parsed against its schema and answered as a text block;
 * - `"binary"`: raw bytes, answered as an `image` or `audio` block.
 *
 * A body served as JSON needs no entry, because the served media type says so; nor does unvalidated
 * text, which is what a non-JSON body with no entry is.
 */
export type BodyKind = "text" | "binary";

/**
 * The body kinds an operation's runtime needs, keyed by the arm's status key as `schemas.gen.ts`
 * writes it (`"200"`, `"4XX"`, `"default"`), and only where one applies.
 *
 * **Per status, not per media type, and that loses nothing.** The library decides `binary` and
 * `textual` per response: `binary` only where EVERY media type is non-JSON, `textual` from the body's
 * type. So every non-JSON media type a status offers has the same kind, and JSON is read off the
 * served type itself.
 */
export function bodyKindsOf(route: EmittedRoute): readonly (readonly [string, BodyKind])[] {
	return route.responses.flatMap((response): (readonly [string, BodyKind])[] => {
		if (response.schema === undefined || response.streamed) return [];
		const offersNonJson = response.contentTypes.some((type) => !isJsonMediaType(type));
		if (!offersNonJson) return [];
		if (response.binary) return [[String(response.status), "binary"]];
		return response.textual ? [[String(response.status), "text"]] : [];
	});
}

/** Each status whose body under some media type is answered unvalidated, with those media types. */
export function unvalidatedResponsesOf(
	route: EmittedRoute,
	names: RouteSchemaNames,
): readonly { readonly status: EmittedResponse["status"]; readonly types: readonly string[] }[] {
	const members = membersOf(route, names);
	return route.responses.flatMap((response) => {
		const types = members
			.filter((member) => member.response === response && bodyServingOf(member) === "unvalidated")
			.flatMap((member) => (member.mediaType === undefined ? [] : [member.mediaType]));
		return types.length === 0 ? [] : [{ status: response.status, types }];
	});
}
