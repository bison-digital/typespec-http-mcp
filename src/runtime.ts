import type { CallToolResult, McpServer, ServerContext } from "@modelcontextprotocol/server";
import type { ZodType } from "zod";

/**
 * **What generated code imports at run time -- and the only thing this package puts in its output.**
 *
 * **Kept deliberately tiny, and deliberately free of every TypeSpec import.** The main entry point
 * is an emitter: it pulls in `@typespec/compiler` and exists at build time. This module is what an
 * *application* touches, and making it reach the compiler would put a build-time dependency into a
 * server's runtime graph for the sake of a few declarations. `test/packaging.test.ts` asserts the
 * separation rather than trusting it.
 *
 * A consumer may substitute this entirely: `runtime-module` decides the specifier the generated
 * files import from, so an application that wants its own declarations points at its own module and
 * re-declares these names.
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
 * One status an operation may answer with, and the schema the document publishes for it.
 *
 * **Declared here rather than imported from `typespec-http-zod`, deliberately.** The emitted
 * `schemas.gen.ts` imports this type from whatever `runtime-module` names, and emitted output must
 * never import this emitter or the library it runs -- a consumer installs both as devDependencies,
 * so a runtime import of either is a broken install. `test/packaging.test.ts` asserts that.
 *
 * The cost is a second declaration of one shape, and `test/runtime/parity.test.ts` is what stops the
 * two drifting: it grades this `armFor` against the library's own for every arm shape.
 *
 * **The arms arrive in OpenAPI's precedence order, so the FIRST match is the right one** -- an exact
 * code, then a range, then the catch-all. `schema: undefined` is a statement rather than an absence:
 * a response the document says carries no body has no validator.
 */
export interface ResponseArm {
	readonly contentTypes?: readonly string[];
	readonly headers?: readonly { readonly name: string; readonly property: string }[];
	readonly status: number | "default" | `${1 | 2 | 3 | 4 | 5}XX`;
	readonly schema: ZodType | undefined;
	readonly when?: { readonly property: string; readonly value: boolean | number | string };
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
		arms.find((arm) => arm.status === `${Math.floor(status / 100)}XX`) ??
		arms.find((arm) => arm.status === "default")
	);
}

/** An OpenAPI security requirement: scheme name to the scopes it demands. */
export type SecurityRequirement = Readonly<Record<string, readonly string[]>>;

/**
 * The application's result envelope. **Defaults to the bare value**, so an application that has none
 * writes nothing; one that does substitutes this module and declares its own.
 */
export type Result<T> = T;

/** The application's caller context. `unknown` until an application substitutes this module. */
export type Ctx = unknown;

export type Awaitable<T> = T | Promise<T>;

/** What the document declares a tool may answer with, handed to {@link ToolDeps.respond}. */
export interface ToolResponses {
	/** The operation's declared responses, in OpenAPI's precedence order. */
	readonly arms: readonly ResponseArm[];
	/**
	 * The schema this tool PUBLISHED, or `undefined` where it published none.
	 *
	 * Carried separately from the arms because MCP obliges a tool declaring an `outputSchema` to
	 * return conforming `structuredContent`, and whether one was published is a decision the emitter
	 * made rather than something readable off the arms.
	 */
	readonly outputSchema: ZodType | undefined;
}

/**
 * The status a handler's value means, per the document's own selector.
 *
 * Where an operation declares one success arm, that is the answer. Where it declares two
 * discriminated by a property of the result, the arm's `when` names the property and the value --
 * the application's own result is read, because only the document knows which property decides.
 */
export function statusOf(arms: readonly ResponseArm[], value: unknown): number {
	const successes = arms.filter(
		(arm): arm is ResponseArm & { status: number } =>
			typeof arm.status === "number" && arm.status < 400,
	);
	for (const arm of successes) {
		if (arm.when === undefined) continue;
		const carried = (value as Record<string, unknown> | null)?.[arm.when.property];
		if (carried === arm.when.value) return arm.status;
	}
	return successes.find((arm) => arm.when === undefined)?.status ?? successes[0]?.status ?? 200;
}

/**
 * The MCP result for a declared status and a value.
 *
 * **In the runtime rather than in `deps`, on the same test the sibling emitter applies**: every rule
 * below is published -- by the document (the arms, the header properties, the `when` selector) or by
 * the MCP specification (the result shape, `isError`, the text mirror). An application forced to
 * supply this would be re-implementing two standards, and getting either wrong differently from
 * everybody else.
 */
export function toolResult(
	declared: ToolResponses,
	status: number,
	value: unknown,
): CallToolResult {
	const arm = armFor(declared.arms, status);

	/**
	 * **`isError` is decided from the STATUS, not from whether the arm is an error model.**
	 *
	 * MCP's `isError` marks a tool-execution error the model can self-correct from, which is exactly
	 * what a declared 4xx or 5xx is: the service's own published failure, with a body the model can
	 * read. It is decided from the status because `armFor` may resolve to `default`, whose numeric
	 * status only the caller knows. `test/statuses/` asserts the two derivations cannot part company.
	 */
	const isError = status >= 400;

	/**
	 * Response headers are not body, and the library already stripped them from the body schema.
	 * They have to be stripped from the VALUE too, or `structuredContent` violates the very
	 * `outputSchema` that was derived from that schema.
	 */
	const headerProperties = new Set((arm?.headers ?? []).map((header) => header.property));
	if (arm?.when !== undefined) headerProperties.add(arm.when.property);

	let body: unknown = value;
	const carriedHeaders: Record<string, unknown> = {};
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		const rest: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
			if (headerProperties.has(key)) carriedHeaders[key] = entry;
			else rest[key] = entry;
		}
		body = rest;
	}

	// A bodyless arm carries nothing a model can read, and inventing a confirmation sentence would
	// state something the document does not. `content: []` is present, is an array, and is honest.
	const hasBody = arm?.schema !== undefined && value !== undefined;

	const result: {
		content: { type: "text"; text: string }[];
		structuredContent?: unknown;
		isError?: boolean;
		_meta?: Record<string, unknown>;
	} = {
		// The text mirror is kept even beside `structuredContent`: MCP recommends it for clients that
		// read only `content`.
		content: hasBody ? [{ type: "text", text: JSON.stringify(body) }] : [],
	};

	if (hasBody && declared.outputSchema !== undefined) result.structuredContent = body;
	if (isError) result.isError = true;

	/**
	 * **Response headers go to `_meta`, never to `structuredContent`.**
	 *
	 * Putting them in `structuredContent` breaks the declared `outputSchema`, which MCP forbids;
	 * dropping them is a loss the consumer cannot see. `_meta` is MCP's slot for implementation data
	 * outside the tool contract, and the key is namespaced so it collides with nothing. A model
	 * cannot read `_meta`, so a value that matters to a caller belongs in the response body -- which
	 * `headers-only-success` warns about.
	 */
	if (Object.keys(carriedHeaders).length > 0) {
		result._meta = { "typespec-http-mcp/response-headers": carriedHeaders };
	}

	return result as CallToolResult;
}

/**
 * What the emitter cannot derive from the document, and the application must answer.
 *
 * The admission test for a member is the sibling emitter's: *the generated code cannot proceed
 * without an answer*. Everything derivable lives above, in the runtime.
 */
export interface ToolDeps {
	/**
	 * Whether the caller this server was built for may SEE this tool.
	 *
	 * **Consulted at REGISTRATION, not at call time.** The MCP specification says the tool set may
	 * vary by the authorisation presented on the request, since credentials are per-request input
	 * rather than connection state -- so the idiomatic gesture is that a caller does not see a tool
	 * they cannot call, rather than being refused after calling it. That is a genuine divergence
	 * from an HTTP surface, where a 403 is the right answer and middleware is the right shape.
	 *
	 * Receives the document's own `security` for the operation: satisfying ANY ONE requirement
	 * authorises, and every scheme WITHIN a requirement must be satisfied together. `[]` where the
	 * operation declares `@useAuth(NoAuth)` or nothing -- a fact rather than an absence, because an
	 * application may still choose to hide a public tool from an anonymous caller.
	 *
	 * A grant that selects nothing is not an error: nothing is registered and `tools/list` answers
	 * with a well-formed empty list. `registerTools` returns the names it did register, which is how
	 * an application observes that.
	 */
	readonly permits: (requirements: readonly SecurityRequirement[]) => boolean;

	/**
	 * The caller's context, or `null` when there is none to establish.
	 *
	 * `authentication` is what the DOCUMENT says and only that: `"none"` where the operation declares
	 * `@useAuth(NoAuth)` and `"required"` otherwise, decided at generation time. Nothing richer is
	 * offered, because nothing richer is published -- the sibling emitter once invented a distinction
	 * from whether a path had parameters, which no OpenAPI keyword expresses.
	 */
	readonly context: (context: ServerContext, authentication: "none" | "required") => Ctx | null;

	/** The result when {@link context} returns `null`. The application's envelope, so its own. */
	readonly noContext: (context: ServerContext) => CallToolResult;

	/**
	 * Turn a handler's result into a tool result, against what the document declares it may say.
	 *
	 * **This is where `Result<T>` is unwrapped, and it is the only place that can be.** The emitter
	 * has no idea what a failure looks like in this application and must not invent one. An
	 * application with no envelope of its own writes
	 * `toolResult(declared, statusOf(declared.arms, result), result)` and is finished.
	 */
	readonly respond: (
		context: ServerContext,
		declared: ToolResponses,
		result: unknown,
	) => Awaitable<CallToolResult>;
}
