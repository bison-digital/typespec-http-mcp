import {
	type EmittedResponse,
	type EmittedRoute,
	isJsonMediaType,
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

export function membersOf(route: EmittedRoute, names: RouteSchemaNames): ResultMember[] {
	return resultMembersOf(route.responses, (response) => response.schema !== undefined).map(
		(member) => ({ ...member, schemaName: names.arms[member.index]?.schema }),
	);
}

export { isJsonMediaType };

/**
 * How the runtime answers a body where its media type does not say.
 *
 * - `"text"`: a string body, parsed against its schema and answered as a text block;
 * - `"binary"`: raw bytes, answered as an `image` or `audio` block, or as an embedded resource.
 *
 * A body served as JSON needs no entry, because the served media type says so; nor does unvalidated
 * text, which is what a non-JSON body with no entry is.
 */
export type BodyKind = "text" | "binary";

/**
 * The body kinds an operation's runtime needs, keyed by the arm's status key as `schemas.gen.ts`
 * writes it (`"200"`, `"4XX"`, `"default"`) and the media type as declared, and only where one
 * applies.
 *
 * **Read off the library's members, one per status and media type.** A status may offer one model as
 * XML, the text a handler writes, and as `application/octet-stream`, its bytes; a kind per status
 * could not say both. A file declared `application/json` is bytes, so it has an entry too.
 */
export function bodyKindsOf(
	route: EmittedRoute,
	names: RouteSchemaNames,
): readonly (readonly [string, string, BodyKind])[] {
	return membersOf(route, names).flatMap((member): (readonly [string, string, BodyKind])[] =>
		member.mediaType !== undefined && (member.serving === "text" || member.serving === "binary")
			? [[String(member.response.status), member.mediaType, member.serving]]
			: [],
	);
}

/** Each status whose body under some media type is answered unvalidated, with those media types. */
export function unvalidatedResponsesOf(
	route: EmittedRoute,
	names: RouteSchemaNames,
): readonly { readonly status: EmittedResponse["status"]; readonly types: readonly string[] }[] {
	const members = membersOf(route, names);
	return route.responses.flatMap((response) => {
		const types = members
			.filter((member) => member.response === response && member.unvalidated)
			.flatMap((member) => (member.mediaType === undefined ? [] : [member.mediaType]));
		return types.length === 0 ? [] : [{ status: response.status, types }];
	});
}
