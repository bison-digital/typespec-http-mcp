import type { CallToolResult, McpServer, ServerContext } from "@modelcontextprotocol/server";
import type { ZodError, ZodType } from "zod";

/**
 * **What generated code imports at run time -- and the only thing this package puts in its output.**
 *
 * **Kept deliberately tiny, and deliberately free of every TypeSpec import.** The main entry point
 * is an emitter: it pulls in `@typespec/compiler` and exists at build time. This module is what an
 * *application* touches, and making it reach the compiler would put a build-time dependency into a
 * server's runtime graph for the sake of a few declarations. `test/packaging.test.ts` asserts the
 * separation rather than trusting it.
 *
 * **Always emitted, never substituted.** `runtime-module` used to point the generated file at a
 * module of the application's own, which made the application own a copy of the arm selection and
 * the result rules below. Nothing it was for needs it now: the caller context is inferred from
 * `deps.context`, and what a handler returns is the union of the responses the document declares.
 */

/**
 * The SDK types the generated signatures name, re-exported so emitted code has ONE specifier.
 *
 * **`export type`, not `export`.** Measured: `McpServer`, `ServerContext` and `CallToolResult` are
 * type-only exports of `@modelcontextprotocol/server`; only `isCallToolResult` is a runtime value
 * among them. A value re-export of any of these compiles and then fails at run time with
 * `SyntaxError: The requested module does not provide an export named ...`.
 */
export type { CallToolResult, McpServer, ServerContext };

/**
 * One status an operation may answer with, and what the document publishes for it.
 *
 * **Declared here rather than imported from `typespec-http-zod`, deliberately.** Emitted output must
 * never import this emitter or the library it runs -- a consumer installs both as devDependencies,
 * so a runtime import of either is a broken install. `test/packaging.test.ts` asserts that. The
 * emitted `schemas.gen.ts` declares the same shape locally, so it depends on no runtime at all.
 *
 * The cost is a second declaration of one shape, and `test/runtime/parity.test.ts` is what stops the
 * two drifting: it grades this `armFor` against the library's own for every arm shape.
 *
 * **The arms arrive in OpenAPI's precedence order, so the FIRST match is the right one** -- an exact
 * code, then a range, then the catch-all. `schema: undefined` is a statement rather than an absence:
 * a response the document says carries no body has no validator.
 */
export interface ResponseArm {
	/** Every media type this response offers, including a single one. Absent where there is no body. */
	readonly contentTypes?: readonly string[];
	/**
	 * The headers this response declares, by the WIRE name the response sets. `optional` is the
	 * document's `required: false`. Absent where the response declares none.
	 */
	readonly headers?: readonly { readonly name: string; readonly optional: boolean }[];
	readonly status: number | "default" | `${1 | 2 | 3 | 4 | 5}XX`;
	readonly schema: ZodType | undefined;
}

/**
 * The arm that answers for a status, in the document's own precedence order.
 *
 * Exact code, then the `NXX` range, then `default`. Sorting the rule out once here is what stops
 * every application re-deriving it, and getting it silently wrong when a `404` and a `4XX` both apply.
 */
export function armFor(arms: readonly ResponseArm[], status: number): ResponseArm | undefined {
	return (
		arms.find((arm) => arm.status === status) ??
		arms.find((arm) => arm.status === `${Math.floor(status / 100) as 1 | 2 | 3 | 4 | 5}XX`) ??
		arms.find((arm) => arm.status === "default")
	);
}

/** An OpenAPI security requirement: scheme name to the scopes it demands. */
export type SecurityRequirement = Readonly<Record<string, readonly string[]>>;

export type Awaitable<T> = T | Promise<T>;

/** What the document declares a tool may answer with, handed to {@link toolResult}. */
export interface ToolResponses {
	/** The operation's declared responses, in OpenAPI's precedence order. */
	readonly arms: readonly ResponseArm[];
	/**
	 * The schema this tool PUBLISHED, or `undefined` where it published none.
	 *
	 * Carried separately from the arms because MCP obliges a tool declaring an `outputSchema` to
	 * return conforming `structuredContent`, and which arm's schema was published is a decision the
	 * emitter made rather than something readable off the arms.
	 */
	readonly outputSchema: ZodType | undefined;
	/**
	 * How a body is answered under a media type that is not JSON, keyed by the arm's status key
	 * (`"200"`, `"4XX"`, `"default"`), and present only where one applies.
	 *
	 * **Carried because an arm cannot say it.** The arm names the media types and the schema, and
	 * neither tells a string body apart from raw bytes or from a model the handler serialised: an
	 * `image/png` body and an `application/xml` one both arrive as a schema and a non-JSON type. The
	 * emitter knows, from what the document declares the body to be.
	 *
	 * - `"text"`: a string, parsed against the arm's schema and answered as a `text` block;
	 * - `"binary"`: raw bytes, answered as an `image` or `audio` block.
	 *
	 * A status with no entry answers a non-JSON body as the text the handler supplied, unvalidated. A
	 * body served as JSON needs no entry, because the served media type says so.
	 */
	readonly bodies?: { readonly [status: string]: "text" | "binary" };
}

/**
 * A response body that does not match the schema the document publishes for its status.
 *
 * **Thrown, so the application decides what a contract failure answers with**, the same class and
 * the same fields as the sibling server emitter's. The MCP server turns a thrown error into a
 * tool-execution error; an application that wants something else catches it around `registerTools`'
 * handlers.
 *
 * `issues` are Zod's, so they carry paths and codes. They also carry the offending VALUES; an
 * application that logs them should decide whether its results may contain anything it would not
 * log.
 */
export class ResponseContractError extends Error {
	readonly operationId: string;
	readonly status: number;
	readonly issues: ZodError["issues"];

	/**
	 * Fields declared and assigned rather than written as parameter properties, which are not
	 * erasable syntax: a consumer building with `erasableSyntaxOnly` could not compile this file.
	 */
	constructor(operationId: string, status: number, issues: ZodError["issues"]) {
		super(`${operationId} answered ${status} with a body its document does not permit`);
		this.name = "ResponseContractError";
		this.operationId = operationId;
		this.status = status;
		this.issues = issues;
	}
}

/**
 * A handler answered with a status its operation does not declare.
 *
 * **Unreachable from a typed handler.** The generated `Tools` interface types every result as the
 * union of the declared statuses, so a literal outside it does not compile. This is what a CAST
 * produces, or a result that crossed a boundary the type system cannot see into. Thrown rather than
 * answered, because answering would publish a status the contract does not state.
 */
export class UndeclaredStatusError extends Error {
	readonly operationId: string;
	readonly result: unknown;

	constructor(operationId: string, result: unknown) {
		const status =
			typeof result === "object" && result !== null && "status" in result
				? String(result.status)
				: "no status";
		super(`${operationId} answered ${status}, which its document does not declare`);
		this.operationId = operationId;
		this.result = result;
		this.name = "UndeclaredStatusError";
	}
}

/** A media type whose body is a JSON value. The rule the library and the server emitter apply. */
function isJsonMediaType(type: string): boolean {
	return /^application\/(json|.*\+json)$/.test(type);
}

/** RFC 9110 `token`, less `*`, which names a range rather than a type. */
const MEDIA_TOKEN = "[!#$%&'+.^_`|~0-9A-Za-z-]+";
const SERVED_MEDIA_TYPE = new RegExp(`^(${MEDIA_TOKEN})/${MEDIA_TOKEN}\\s*(;.*)?$`);

/**
 * Whether an offered media type, which may be a range such as `image/*`, admits a served one.
 *
 * The sibling server emitter's `mediaTypeWithin`, rule for rule: a range admits a concrete type inside
 * it, never its own spelling or a type with no subtype; type names compare case-insensitively
 * (RFC 9110 section 8.3.1), and parameters such as `charset` are allowed.
 */
function admits(offered: string, served: string): boolean {
	if (!offered.endsWith("/*")) return offered === served;
	const type = SERVED_MEDIA_TYPE.exec(served)?.[1];
	if (type === undefined) return false;
	if (offered === "*/*") return true;
	return type.toLowerCase() === offered.slice(0, -2).toLowerCase();
}

/**
 * The media type a result is served as, or `undefined` where the arm names none.
 *
 * Where the arm offers several, or only a wildcard range, the handler names the one it answers with,
 * and a type the arm does not offer is as undeclared as a status it does not. A range admits every
 * type inside it: `image/*` is what lets a handler answer `image/png`.
 */
function mediaTypeOf(
	arm: ResponseArm,
	contentType: unknown,
	operationId: string,
	result: unknown,
): string | undefined {
	const offered = arm.contentTypes ?? [];
	const choosing = offered.length > 1 || offered.some((type) => type.endsWith("/*"));
	if (!choosing) return offered[0];
	if (typeof contentType === "string" && offered.some((type) => admits(type, contentType))) {
		return contentType;
	}
	throw new UndeclaredStatusError(operationId, result);
}

/** A body that is not what its arm says it is, as one issue in Zod's own shape. */
function refusedBody(input: unknown, message: string): ZodError["issues"] {
	return [{ code: "custom", path: [], message, input }];
}

/**
 * **A stream of bytes, as every platform's `ReadableStream<Uint8Array>` satisfies it.**
 *
 * The same structural type `typespec-http-zod` publishes in `requests.gen.ts` and `typespec-hono`
 * declares in its runtime, so a backend whose result is typed by the framework-free contract can be
 * returned from a handler as it is. Declared here rather than imported because this file is copied
 * into a consumer's Worker, where the emitter packages are not installed; the agreement test holds
 * the declarations identical.
 */
export interface ByteStream {
	getReader(): {
		read(): Promise<{ readonly done: boolean; readonly value?: Uint8Array | undefined }>;
		releaseLock(): void;
		cancel?(reason?: unknown): Promise<void>;
	};
}

/**
 * The bytes of a binary body, which a handler may hand over in any of the forms the result type admits.
 *
 * A stream is buffered: a tool result is one message, and the block carries the whole of it. It is
 * read through its reader, which is all `ByteStream` promises, so a stream that is not the platform's
 * - a contract value from a backend, a test double - is read the same way. A value that is not a
 * `Uint8Array` is not a byte, and refuses the body rather than being coerced.
 */
async function bytesOf(body: unknown): Promise<Uint8Array | undefined> {
	if (body instanceof Uint8Array) return body;
	if (body instanceof ArrayBuffer) return new Uint8Array(body);
	if (!isByteStream(body)) return undefined;
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			// A read may report no chunk and not be done, which `ByteStream` admits; it carries nothing.
			if (value === undefined) continue;
			if (!(value instanceof Uint8Array)) {
				// Refused part-way, so the producer is told it will not be read further.
				await reader.cancel?.(value);
				return undefined;
			}
			chunks.push(value);
			length += value.byteLength;
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

function isByteStream(value: unknown): value is ByteStream {
	return (
		typeof value === "object" &&
		value !== null &&
		"getReader" in value &&
		typeof value.getReader === "function"
	);
}

/** Base64, in chunks, so a large body does not exceed the argument limit of one call. */
function base64Of(bytes: Uint8Array): string {
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
	}
	return btoa(binary);
}

/** One block of a tool result, as the MCP specification defines the ones this runtime answers with. */
type ContentBlock =
	| { readonly type: "text"; readonly text: string }
	| { readonly type: "image" | "audio"; readonly data: string; readonly mimeType: string };

/**
 * The MCP result for what a handler returned: `{ status, body, headers }` for a response the
 * document declares.
 *
 * **In the runtime rather than in `deps`, on the same test the sibling emitter applies**: every rule
 * below is published -- by the document (the arms, their bodies, their headers) or by the MCP
 * specification (the result shape, its content blocks, `isError`, the text mirror). An application
 * forced to supply this would be re-implementing two standards, and getting either wrong differently
 * from everybody else.
 *
 * **What is answered is the PARSED body, not the one the handler returned**, as on the HTTP surface:
 * a schema that strips undeclared keys strips them here too, so a field the document does not publish
 * does not reach a model.
 *
 * Asynchronous because a binary body may be a stream, which is read to its end before it is answered.
 */
export async function toolResult(
	declared: ToolResponses,
	operationId: string,
	result: unknown,
): Promise<CallToolResult> {
	const answer: {
		readonly status?: unknown;
		readonly contentType?: unknown;
		readonly body?: unknown;
		readonly headers?: unknown;
	} = typeof result === "object" && result !== null ? result : {};
	const { status } = answer;
	const arm = typeof status === "number" ? armFor(declared.arms, status) : undefined;
	if (arm === undefined || typeof status !== "number") {
		throw new UndeclaredStatusError(operationId, result);
	}
	const mediaType = mediaTypeOf(arm, answer.contentType, operationId, result);

	/**
	 * **`isError` is decided from the STATUS, not from whether the arm is an error model.**
	 *
	 * MCP's `isError` marks a tool-execution error the model can self-correct from, which is exactly
	 * what a declared 4xx or 5xx is: the service's own published failure, with a body the model can
	 * read. It is decided from the status because `armFor` may resolve to a range or `default`, whose
	 * numeric status only the result carries.
	 */
	const isError = status >= 400;

	const toolAnswer: {
		content: ContentBlock[];
		structuredContent?: unknown;
		isError?: boolean;
		_meta?: Record<string, unknown>;
	} = { content: [] };

	/** Whether the body was answered as JSON text, which `structuredContent` then mirrors. */
	let servedAsJson = false;

	/**
	 * A bodyless arm carries nothing a model can read, and inventing a confirmation sentence would
	 * state something the document does not, so `content` stays `[]`: present, an array, and honest.
	 */
	if (arm.schema !== undefined && answer.body !== undefined) {
		const kind = declared.bodies?.[String(arm.status)];
		if (mediaType === undefined || isJsonMediaType(mediaType)) {
			/**
			 * **Validated wherever the body is served as JSON**, which is also the only form a tool result
			 * can carry structurally. An arm naming no media type is a hand-written arm, and a tool
			 * result's text is JSON, so it is validated too.
			 */
			const parsed = arm.schema.safeParse(answer.body);
			if (!parsed.success) {
				throw new ResponseContractError(operationId, status, parsed.error.issues);
			}
			servedAsJson = true;
			// The text mirror is kept even beside `structuredContent`: MCP recommends it for clients
			// that read only `content`.
			toolAnswer.content = [{ type: "text", text: JSON.stringify(parsed.data) }];
			/**
			 * **Where this arm's schema IS the published `outputSchema`.** MCP obliges a tool that
			 * declares an `outputSchema` to return conforming `structuredContent`, and a failure's body
			 * does not conform to the success schema the tool published.
			 */
			if (declared.outputSchema !== undefined && arm.schema === declared.outputSchema) {
				toolAnswer.structuredContent = parsed.data;
			}
		} else if (kind === "text") {
			/**
			 * **A string body under a media type that is not JSON IS the text**, so it is checked against
			 * its schema exactly as the sibling server emitter checks it, and the parsed string answered.
			 */
			const parsed = arm.schema.safeParse(answer.body);
			if (!parsed.success) {
				throw new ResponseContractError(operationId, status, parsed.error.issues);
			}
			toolAnswer.content = [{ type: "text", text: String(parsed.data) }];
		} else if (kind === "binary") {
			/**
			 * **Raw bytes are answered as the block MCP defines for their media type**, carrying the data
			 * as base64 and the media type served. The emitter refuses every other binary media type, so
			 * one reaching here was declared by hand.
			 */
			const block = /^(image|audio)\//.exec(mediaType)?.[1];
			if (block !== "image" && block !== "audio") {
				throw new ResponseContractError(
					operationId,
					status,
					refusedBody(answer.body, `no MCP content block carries a binary body as ${mediaType}`),
				);
			}
			const bytes = await bytesOf(answer.body);
			if (bytes === undefined) {
				throw new ResponseContractError(
					operationId,
					status,
					refusedBody(
						answer.body,
						"a binary body is a Uint8Array, an ArrayBuffer or a stream of Uint8Array chunks",
					),
				);
			}
			toolAnswer.content = [{ type: block, data: base64Of(bytes), mimeType: mediaType }];
		} else {
			/**
			 * **A model under a media type that is not JSON is text the handler serialised**, which the
			 * schema does not describe, so it is answered as it is. `unvalidated-response-media-type`
			 * said so at compile time. Anything but a string is not that text.
			 */
			if (typeof answer.body !== "string") {
				throw new ResponseContractError(
					operationId,
					status,
					refusedBody(
						answer.body,
						`a body answered as ${mediaType} is the text the handler supplies`,
					),
				);
			}
			toolAnswer.content = [{ type: "text", text: answer.body }];
		}
	}

	/**
	 * **A success the published `outputSchema` does not describe fails here, by name.**
	 *
	 * The SDK refuses a result that is not an error and carries no `structuredContent` once a tool
	 * declares an `outputSchema`. The emitter publishes one only where every 2xx and 3xx response the
	 * document declares shares its body, but `default` covers the statuses nobody listed, 2xx and 3xx
	 * among them. Such a success is answered only if its body also meets the published schema;
	 * otherwise it is the contract failure it is, rather than the SDK's "no structured content".
	 *
	 * **The body the HANDLER returned is checked, not the one its own arm parsed.** An object schema
	 * strips the keys it does not declare, so a `Problem`-parsed body has already lost every key a
	 * `Widget` needs: checking that would refuse a body that meets both. The text mirror is then the
	 * published schema's parse, because that is what `structuredContent` carries.
	 */
	if (
		!isError &&
		declared.outputSchema !== undefined &&
		toolAnswer.structuredContent === undefined
	) {
		const conforming = declared.outputSchema.safeParse(answer.body);
		if (!conforming.success) {
			throw new ResponseContractError(operationId, status, conforming.error.issues);
		}
		toolAnswer.structuredContent = conforming.data;
		if (servedAsJson) {
			toolAnswer.content = [{ type: "text", text: JSON.stringify(conforming.data) }];
		}
	}

	if (isError) toolAnswer.isError = true;

	/**
	 * **Response headers go to `_meta`, keyed by the WIRE name, never to `structuredContent`.**
	 *
	 * Putting them in `structuredContent` breaks the declared `outputSchema`, which MCP forbids;
	 * dropping them is a loss the consumer cannot see. `_meta` is MCP's slot for implementation data
	 * outside the tool contract, and the key is namespaced so it collides with nothing. Only the
	 * headers the arm declares are carried, and an optional one the handler left out is omitted. A
	 * model cannot read `_meta`, so a value that matters to a caller belongs in the response body --
	 * which `headers-only-success` warns about.
	 */
	const supplied =
		typeof answer.headers === "object" && answer.headers !== null
			? (answer.headers as Readonly<Record<string, unknown>>)
			: {};
	const carried: Record<string, unknown> = {};
	for (const header of arm.headers ?? []) {
		const value = supplied[header.name];
		if (value !== undefined) carried[header.name] = value;
	}
	if (Object.keys(carried).length > 0) {
		toolAnswer._meta = { "typespec-http-mcp/response-headers": carried };
	}

	return toolAnswer as CallToolResult;
}

/**
 * What the emitter cannot derive from the document, and the application must answer.
 *
 * The admission test for a member is the sibling emitter's: *the generated code cannot proceed
 * without an answer*. Everything derivable lives above, in the runtime.
 *
 * **`C` is the caller context, and `registerTools` INFERS it from `context`.** An application whose
 * `context` returns a `Caller` has handlers typed `(ctx: Caller, input)`, with nothing to declare.
 */
export interface ToolDeps<C = unknown> {
	/**
	 * Whether the caller this server was built for may SEE this tool.
	 *
	 * **Consulted at REGISTRATION, not at call time.** The MCP specification says the tool set may
	 * vary by the authorisation presented on the request, since credentials are per-request input
	 * rather than connection state -- so the idiomatic gesture is that a caller does not see a tool
	 * they cannot call, rather than being refused after calling it. That is a genuine divergence
	 * from an HTTP surface, where a 403 is the right answer and middleware is the right shape.
	 *
	 * Receives the `security` the document publishes for the operation: satisfying ANY ONE requirement
	 * authorises, and every scheme WITHIN a requirement must be satisfied together. An anonymous
	 * alternative is the empty requirement `{}`, which every caller satisfies: `@useAuth(NoAuth)` is
	 * `[{}]` and `NoAuth | BearerAuth` is `[{}, { BearerAuth: [] }]`. An operation declaring no auth
	 * at all is `[]`. Both are facts rather than absences, because an application may still choose to
	 * hide a public tool from an anonymous caller.
	 *
	 * A grant that selects nothing is not an error: nothing is registered and `tools/list` answers
	 * with a well-formed empty list. `registerTools` returns the names it did register, which is how
	 * an application observes that.
	 */
	readonly permits: (requirements: readonly SecurityRequirement[]) => boolean;

	/**
	 * The caller's context, or `null` when there is none to establish.
	 *
	 * `authentication` is what the DOCUMENT says and only that, decided at generation time:
	 *
	 * - `"none"`: no alternative asks for anything, `@useAuth(NoAuth)` or no auth at all;
	 * - `"optional"`: an anonymous alternative sits beside a real one, `NoAuth | BearerAuth`, so a
	 *   caller presenting a credential is recognised and one presenting none is still admitted;
	 * - `"required"`: every alternative asks for something.
	 *
	 * Nothing richer is offered, because nothing richer is published -- the sibling emitter once
	 * invented a distinction from whether a path had parameters, which no OpenAPI keyword expresses.
	 */
	readonly context: (
		context: ServerContext,
		authentication: "none" | "optional" | "required",
	) => C | null;

	/** The result when {@link context} returns `null`. The application's to decide. */
	readonly noContext: (context: ServerContext) => CallToolResult;
}
