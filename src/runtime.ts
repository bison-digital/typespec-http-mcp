import {
	type CallToolResult,
	type McpServer,
	MissingRequiredClientCapabilityError,
	ProtocolError,
	ProtocolErrorCode,
	type ServerContext,
} from "@modelcontextprotocol/server";
import { z, type ZodError, type ZodType } from "zod";

/**
 * **What generated code imports at run time -- and the only thing this package puts in its output.**
 *
 * **Kept deliberately tiny, and deliberately free of every TypeSpec import.** The main entry point
 * is an emitter: it pulls in `@typespec/compiler` and exists at build time. This module is what an
 * *application* touches, and making it reach the compiler would put a build-time dependency into a
 * server's runtime graph for the sake of a few declarations. typespec-http-mcp's packaging suite asserts the
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
 * so a runtime import of either is a broken install. typespec-http-mcp's packaging suite asserts that. The
 * emitted `schemas.gen.ts` declares the same shape locally, so it depends on no runtime at all.
 *
 * The cost is a second declaration of one shape, and typespec-http-mcp's runtime parity suite is what stops the
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
	 * How a body is answered where its media type does not say, keyed by the arm's status key
	 * (`"200"`, `"4XX"`, `"default"`) and then by the media type as the arm declares it, and present
	 * only where one applies.
	 *
	 * **Carried because an arm cannot say it.** The arm names the media types and the schema, and
	 * neither tells a string body apart from raw bytes or from a model the handler serialised: an
	 * `image/png` body and an `application/xml` one both arrive as a schema and a non-JSON type. The
	 * emitter knows, from what the document declares the body to be. **By media type as well as by
	 * status**, because one status may offer one model as XML, the text the handler writes, and as
	 * `application/octet-stream`, its bytes.
	 *
	 * - `"text"`: a string, parsed against the arm's schema and answered as a `text` block;
	 * - `"binary"`: raw bytes, answered as an `image` or `audio` block, or as an embedded resource
	 *   under any other type, a file declared `application/json` included.
	 *
	 * A media type with no entry answers a JSON body as JSON, and any other body as the text the
	 * handler supplied, unvalidated.
	 */
	readonly bodies?: {
		readonly [status: string]: { readonly [mediaType: string]: "text" | "binary" };
	};
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

/**
 * A media type whose body is a JSON value. The rule the library and the server emitter apply, to the
 * media type's essence: `type/subtype`, lowercased, with no parameters (RFC 9110 section 8.3.1), so
 * `application/json; charset=utf-8` is JSON.
 */
function isJsonMediaType(type: string): boolean {
	return /^application\/(json|.*\+json)$/.test((type.split(";")[0] ?? "").trim().toLowerCase());
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
 * declares in its runtime, so a value typed by the framework-free contract can be returned from a
 * handler as it is. Declared here rather than imported because this file is copied into a
 * consumer's Worker, where the emitter packages are not installed; the agreement test holds the
 * declarations identical.
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
 * - a contract value, a test double - is read the same way. A value that is not a `Uint8Array` is
 * not a byte, and refuses the body rather than being coerced.
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

/**
 * **The URI an embedded resource names: this operation's response, which nothing resolves.**
 *
 * The specification requires the `uri` and does not require that `resources/read` answer it: a tool
 * may embed a resource "to provide additional context or data using a suitable URI scheme", and a
 * custom scheme is allowed where it follows RFC 3986. The bytes are one call's answer, so there is
 * nothing to list or read back, and this server declares no `resources` capability, which the
 * specification asks for with a SHOULD. Stainless's MCP servers name such a body
 * `resource://tool-response`; this names the operation too, so two tools' answers are not one URI.
 */
const TOOL_RESPONSE_URI = "resource://tool-response/";

/** One block of a tool result, as the MCP specification defines the ones this runtime answers with. */
type ContentBlock =
	| { readonly type: "text"; readonly text: string }
	| { readonly type: "image" | "audio"; readonly data: string; readonly mimeType: string }
	| {
			readonly type: "resource";
			readonly resource: { readonly uri: string; readonly mimeType: string; readonly blob: string };
	  };

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
		const kinds = declared.bodies?.[String(arm.status)] ?? {};
		const kind =
			mediaType === undefined
				? undefined
				: Object.entries(kinds).find(([declaredType]) => admits(declaredType, mediaType))?.[1];
		if (kind === "binary" && mediaType !== undefined) {
			/**
			 * **Raw bytes are bytes whatever the media type**, as the library places a file, so a file
			 * declared `application/json` is not parsed and re-serialised. They are answered as the block
			 * MCP defines for their media type, `image` or `audio`, and as an embedded resource under any
			 * other: a blob with the media type served.
			 */
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
			const block = /^(image|audio)\//.exec(mediaType.toLowerCase())?.[1];
			toolAnswer.content = [
				block === "image" || block === "audio"
					? { type: block, data: base64Of(bytes), mimeType: mediaType }
					: {
							type: "resource",
							resource: {
								uri: `${TOOL_RESPONSE_URI}${encodeURIComponent(operationId)}`,
								mimeType: mediaType,
								blob: base64Of(bytes),
							},
						},
			];
		} else if (mediaType === undefined || isJsonMediaType(mediaType)) {
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
		} else {
			/**
			 * **A model under a textual media type that is not JSON is text the handler serialised**,
			 * which the schema does not describe, so it is answered as it is; under a type that is not
			 * text it is bytes, and has a `binary` entry. `unvalidated-response-media-type` said so at
			 * compile time. Anything but a string is not that text.
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
export interface ToolDeps<C = unknown, Call extends ToolCallShape = never> {
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

	/**
	 * Which tools may answer with an MCP task, and how a task is created. Absent, no tool ever does.
	 *
	 * **The application's to decide, because the document cannot say it.** The Tasks extension has
	 * no per-tool declaration: the server decides on each request whether to answer with a task.
	 * Whether a tool's work outlives a request is a fact about where the application runs it, not
	 * about the operation.
	 *
	 * **Typed by the generated `ToolCall`, so write `ToolDeps<Caller, ToolCall>` to set it.** The
	 * policy names operations, and only the generated module knows which exist. `ToolDeps<Caller>`
	 * names none, so it admits no operation, and wiring written before tasks existed compiles as it
	 * did.
	 */
	readonly tasks?: ToolTasks<C, Call>;
}

/** What a tool call is, to the code that runs it later: the operation and its validated input. */
export interface ToolCallShape {
	readonly operationId: string;
	readonly input: unknown;
}

/**
 * The application's task policy for the tools one `registerTools` call registers.
 *
 * **`decide` and `create` are METHOD signatures, deliberately.** That keeps the policy covariant in
 * `Call`, so `ToolDeps<Caller>`, which lists no operation, is still a `ToolDeps<Caller, ToolCall>`.
 * With property signatures the two would be unrelated, and every wiring written before tasks existed
 * would stop compiling.
 *
 * **A request that did not declare the Tasks extension never reaches this policy.** It is answered
 * inline, as if no policy were configured, because the extension forbids answering it with a task.
 */
export interface ToolTasks<C, Call extends ToolCallShape> {
	/**
	 * The operations that may answer with a task.
	 *
	 * **Read at REGISTRATION, like `permits`**, because it changes what is published: a tool listed
	 * here publishes no `outputSchema`. The SDK refuses a task from a tool that publishes one, so a
	 * task tool is an ordinary tool without it, on every request.
	 */
	readonly operations: readonly Call["operationId"][];

	/**
	 * Whether THIS call becomes a task or runs inline. Consulted only for a listed operation and a
	 * request that declared the extension. Absent, every such call becomes a task.
	 *
	 * Receives the validated input and the caller, so the answer can depend on the application's own
	 * state: work that is already finished can be answered at once.
	 */
	decide?(call: Call, caller: C, context: ServerContext): Awaitable<"task" | "inline">;

	/**
	 * Create the task and answer with its handle. In practice
	 * `(call, caller, context) => tasks.create(context, { context: { ...call, ... } })`, where the
	 * application chooses what the store needs to find or start the work: the call, an identifier
	 * for the caller, a service name when one store serves several services.
	 */
	create(call: Call, caller: C, context: ServerContext): Promise<TaskToolResult>;
}

/**
 * The result McpServer answers when a tool callback throws: the message as text, marked as an error.
 *
 * Exported so the work behind a task settles a thrown error exactly as the blocking call would have
 * answered it. The Tasks extension requires a tool error to complete the task with that result,
 * and reserves `failed` for a protocol error.
 */
export function toolError(error: unknown): CallToolResult {
	return {
		content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
		isError: true,
	};
}

/**
 * The MCP Tasks extension (`io.modelcontextprotocol/tasks`) lets a server answer `tools/call` with a
 * task handle, which the client polls with `tasks/get`, answers with `tasks/update` and stops with
 * `tasks/cancel`.
 *
 * **The declarations below have the shape of the SDK's own Tasks extension**, which is not yet in a
 * release. A store written against them satisfies the SDK's `TaskStore` as well, so adopting the
 * SDK's extension replaces one import and one `attach` call, and nothing else.
 */
export const TASKS_EXTENSION_ID = "io.modelcontextprotocol/tasks";

/** A task's state, as every task-related message carries it. */
export interface Task {
	readonly taskId: string;
	readonly status: "working" | "input_required" | "completed" | "cancelled" | "failed";
	readonly statusMessage?: string;
	/** ISO 8601. */
	readonly createdAt: string;
	/** ISO 8601. */
	readonly lastUpdatedAt: string;
	/** Retention from creation, in milliseconds; `null` is unlimited. */
	readonly ttlMs: number | null;
	/** How often a client should poll, in milliseconds. */
	readonly pollIntervalMs?: number;
}

/**
 * What `tasks/get` answers: the task, with what its status carries.
 *
 * **`completed` carries the `CallToolResult` the call would have returned, `isError` included.**
 * `failed` is only for a protocol error during execution, never for a tool that answered an error.
 */
export type DetailedTask =
	| (Task & { readonly status: "working" })
	| (Task & {
			readonly status: "input_required";
			readonly inputRequests: Readonly<Record<string, unknown>>;
	  })
	| (Task & { readonly status: "completed"; readonly result: Readonly<Record<string, unknown>> })
	| (Task & { readonly status: "failed"; readonly error: Readonly<Record<string, unknown>> })
	| (Task & { readonly status: "cancelled" });

/** A tool's answer when its work continues as a task. */
export type CreateTaskResult = Task & { readonly resultType: "task" };

/** The handle a tool callback returns in place of a `CallToolResult`. */
export type TaskToolResult = CallToolResult & CreateTaskResult;

/** What the extension asks a store to create. */
export interface CreateTaskParams {
	/** Retention from creation, in milliseconds; `null` is unlimited. */
	readonly ttlMs: number | null;
	readonly pollIntervalMs?: number;
	/**
	 * The identity of the request that created the task. A store MUST refuse every later access
	 * from a different principal, answering as for an unknown task.
	 */
	readonly principal?: string;
	/** The store's own: whatever its execution needs to find or start the work. */
	readonly context?: Readonly<Record<string, unknown>>;
}

/** The identity presented on a `tasks/*` request. */
export interface TaskAccess {
	readonly principal?: string;
}

/**
 * Where tasks live and how their work is found. The extension owns the protocol; the store owns the
 * state, and the application owns the execution behind it: a queue, a workflow, a durable object.
 *
 * - `create` MUST NOT resolve before a following `get` would find the task.
 * - `get`, `update` and `cancel` answer `undefined` or `false` for a task that is unknown, expired
 *   or another principal's, and the extension answers all three alike.
 * - `cancel` is cooperative and idempotent on a finished task.
 * - Task ids MUST be unguessable.
 */
export interface TaskStore {
	create(params: CreateTaskParams): Promise<Task>;
	get(taskId: string, access?: TaskAccess): Promise<DetailedTask | undefined>;
	update(
		taskId: string,
		inputResponses: Readonly<Record<string, unknown>>,
		access?: TaskAccess,
	): Promise<boolean>;
	cancel(taskId: string, access?: TaskAccess): Promise<boolean>;
}

export interface TasksExtensionOptions {
	/** Retention when `create` is given none, in milliseconds; `null` is unlimited. Default 24 hours. */
	readonly defaultTtlMs?: number | null;
	/** The polling hint when `create` is given none, in milliseconds. Default 5000. */
	readonly defaultPollIntervalMs?: number;
	/**
	 * The identity a task is bound to. Default: the OAuth client id, with the token subject when
	 * the token verifier puts one at `authInfo.extra.sub`. With no authentication it is `undefined`,
	 * and a task's id is then the only credential for it.
	 */
	readonly principal?: (context: ServerContext) => string | undefined;
}

export interface CreateTaskOptions {
	readonly ttlMs?: number | null;
	readonly pollIntervalMs?: number;
	readonly context?: Readonly<Record<string, unknown>>;
}

const CLIENT_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Whether THIS request declared the Tasks extension. A task may be returned only to a request that
 * did, whatever an earlier request declared.
 */
export function declaresTasks(context: ServerContext): boolean {
	const envelope: unknown = context.mcpReq.envelope;
	const capabilities = isRecord(envelope) ? envelope[CLIENT_CAPABILITIES] : undefined;
	const extensions = isRecord(capabilities) ? capabilities["extensions"] : undefined;
	return isRecord(extensions) && TASKS_EXTENSION_ID in extensions;
}

function requireTasks(context: ServerContext, what: string): void {
	if (declaresTasks(context)) return;
	throw new MissingRequiredClientCapabilityError(
		{ requiredCapabilities: { extensions: { [TASKS_EXTENSION_ID]: {} } } },
		`${what} requires the request to declare the "${TASKS_EXTENSION_ID}" extension`,
	);
}

/** On 2025-11-25, which carries no envelope, `tasks/get` and `tasks/cancel` named other methods. */
function requireModern(context: ServerContext): void {
	if (context.mcpReq.envelope === undefined) {
		throw new ProtocolError(ProtocolErrorCode.MethodNotFound, "Method not found");
	}
}

function taskNotFound(): never {
	throw new ProtocolError(ProtocolErrorCode.InvalidParams, "Task not found");
}

function defaultPrincipal(context: ServerContext): string | undefined {
	const authInfo = context.http?.authInfo;
	if (authInfo === undefined) return undefined;
	const subject = authInfo.extra?.["sub"];
	return typeof subject === "string"
		? JSON.stringify([authInfo.clientId, subject])
		: authInfo.clientId;
}

const taskParams = z.object({ taskId: z.string() });
const updateParams = taskParams.extend({
	inputResponses: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Serves the Tasks extension: its capability, `tasks/get`, `tasks/update` and `tasks/cancel`, over
 * the {@link TaskStore} the application supplies. A tool answers with a task through
 * {@link TasksExtension.create}.
 *
 * One instance serves any number of servers; {@link TasksExtension.attach} each one before it
 * connects. Under `createMcpHandler`, which builds a server per request, create the extension
 * once and attach it in the factory.
 */
export class TasksExtension {
	readonly id = TASKS_EXTENSION_ID;
	readonly store: TaskStore;
	readonly #defaultTtlMs: number | null;
	readonly #defaultPollIntervalMs: number;
	readonly #principal: (context: ServerContext) => string | undefined;
	readonly #attached = new WeakSet<McpServer>();

	constructor(store: TaskStore, options: TasksExtensionOptions = {}) {
		this.store = store;
		this.#defaultTtlMs = options.defaultTtlMs === undefined ? 86_400_000 : options.defaultTtlMs;
		this.#defaultPollIntervalMs = options.defaultPollIntervalMs ?? 5000;
		this.#principal = options.principal ?? defaultPrincipal;
	}

	/**
	 * Create a task for the current `tools/call`, bound to the caller, and return the handle the tool
	 * answers with. Refuses with `-32021` when the request did not declare the extension.
	 */
	async create(context: ServerContext, options: CreateTaskOptions = {}): Promise<TaskToolResult> {
		requireTasks(context, "Answering with a task");
		const principal = this.#principal(context);
		const pollIntervalMs = options.pollIntervalMs ?? this.#defaultPollIntervalMs;
		const task = await this.store.create({
			ttlMs: options.ttlMs === undefined ? this.#defaultTtlMs : options.ttlMs,
			pollIntervalMs,
			...(principal === undefined ? {} : { principal }),
			...(options.context === undefined ? {} : { context: options.context }),
		});
		return { resultType: "task", ...task } as TaskToolResult;
	}

	/**
	 * Serve the extension on `server`. Must run before it connects. Attaching this extension to the
	 * same server again does nothing; attaching a second Tasks extension throws and leaves the server
	 * as it was, because its `tasks/*` handlers would silently replace the first one's.
	 */
	attach(server: McpServer): void {
		if (this.#attached.has(server)) return;
		const protocol = server.server;
		if (protocol.getCapabilities().extensions?.[TASKS_EXTENSION_ID] !== undefined) {
			throw new Error(
				`A Tasks extension is already attached to this server; one server serves one task store.`,
			);
		}
		protocol.registerCapabilities({ extensions: { [TASKS_EXTENSION_ID]: {} } });

		const access = (context: ServerContext): TaskAccess => {
			const principal = this.#principal(context);
			return principal === undefined ? {} : { principal };
		};

		protocol.setRequestHandler("tasks/get", { params: taskParams }, async (params, context) => {
			requireModern(context);
			requireTasks(context, "tasks/get");
			const task = await this.store.get(params.taskId, access(context));
			return task === undefined ? taskNotFound() : { resultType: "complete", ...task };
		});

		protocol.setRequestHandler(
			"tasks/update",
			{ params: updateParams },
			async (params, context) => {
				requireModern(context);
				requireTasks(context, "tasks/update");
				const dropped = context.mcpReq.droppedInputResponseKeys ?? [];
				if (dropped.length > 0) {
					throw new ProtocolError(
						ProtocolErrorCode.InvalidParams,
						`inputResponses entries must be bare results; refused: ${dropped.join(", ")}`,
					);
				}
				const inputResponses = context.mcpReq.inputResponses ?? params.inputResponses;
				if (inputResponses === undefined) {
					throw new ProtocolError(
						ProtocolErrorCode.InvalidParams,
						"tasks/update requires inputResponses",
					);
				}
				const found = await this.store.update(params.taskId, inputResponses, access(context));
				return found ? { resultType: "complete" } : taskNotFound();
			},
		);

		protocol.setRequestHandler("tasks/cancel", { params: taskParams }, async (params, context) => {
			requireModern(context);
			requireTasks(context, "tasks/cancel");
			const found = await this.store.cancel(params.taskId, access(context));
			return found ? { resultType: "complete" } : taskNotFound();
		});

		this.#attached.add(server);
	}
}
