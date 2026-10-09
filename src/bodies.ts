import {
	type BodyServing,
	type EmittedResponse,
	type EmittedRoute,
	isJsonMediaType,
	isMediaRange,
	type ResultMember as LibraryResultMember,
	resultMembersOf,
	type RouteSchemaNames,
} from "typespec-http-zod";

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

/**
 * A media type MCP has a content block for: `image/*` and `audio/*`, which carry base64 data and
 * the media type itself. A wildcard within one is a type the handler names when it answers.
 */
export function hasContentBlock(type: string): boolean {
	return /^(image|audio)\/[^/]+$/.test(type);
}

/**
 * One member of a tool's result: the library's member, with the identifier this route's schema for
 * that body is declared under.
 *
 * **The rules are the library's (`resultMembersOf`), read rather than restated.** This package, the
 * sibling server emitter and the contract types each held their own copy, and three copies of rules
 * that must agree are three that will not.
 */
export interface ResultMember extends LibraryResultMember<EmittedResponse> {
	readonly schemaName: string | undefined;
}

export type { BodyServing };

export function bodyServingOf(member: ResultMember): BodyServing {
	return member.serving;
}

export function membersOf(route: EmittedRoute, names: RouteSchemaNames): ResultMember[] {
	return resultMembersOf(route.responses, (response) => response.schema !== undefined).map(
		(member) => ({ ...member, schemaName: names.arms[member.index]?.schema }),
	);
}

export { isJsonMediaType, isMediaRange };

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
