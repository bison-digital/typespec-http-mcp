/**
 * **The claim this package exists to make, written as an application would write it.**
 *
 * ONE handler object, passed to BOTH generated surfaces. If the two emitters ever derive a different
 * signature for the same operation, this file stops compiling -- which is the only check that can
 * see it, because the two are separate packages deriving the same thing by the same rules.
 *
 * **Each surface uses the runtime it emitted, and nothing is substituted.** The caller context is
 * whatever `deps.context` returns on each side, and every handler returns `{ status, body, headers }`
 * for a response the document declares, failures included.
 *
 * Excluded from `pnpm typecheck` by `tsconfig.json` (`**\/*.fixture.ts`): it imports from a
 * gitignored output directory, so checking it there would make a fresh clone fail before its first
 * build. `agreement.test.ts` compiles it against freshly emitted output instead, which cannot go
 * stale.
 *
 * **Every line below is load-bearing.** See the docblocks.
 */
import { Hono } from "hono";
import { registerRoutes, type Operations } from "./.out/agreement/app.gen.js";
import { registerTools, type Tools } from "./.out/agreement/mcp.gen.js";
import type { McpServer, ToolDeps } from "./.out/agreement/mcp-runtime.gen.js";
import type { AppEnv, ByteStream, RouteDeps } from "./.out/agreement/runtime.gen.js";

/** The tool runtime's own stream type, named apart from the server runtime's. */
type ToolByteStream = import("./.out/agreement/mcp-runtime.gen.js").ByteStream;

/** What both surfaces' `deps.context` establish, and therefore what every handler receives. */
interface Caller {
	readonly subject: string;
}

declare const routeDeps: RouteDeps<AppEnv, Caller>;
declare const toolDeps: ToolDeps<Caller>;
declare const server: McpServer;

const widget = { id: "1", name: "a", colour: "grey" };

/** A stream that is a reader and nothing more, as the framework-free contract types one. */
declare const reader: ToolByteStream;

/**
 * **`satisfies`, not an annotation.** An annotation widens the value to the annotation, `T` then
 * infers as that annotation, `Exclude<keyof T, ...>` collapses to `never`, and the surplus-key guard
 * in BOTH `registerRoutes` and `registerTools` evaporates. `satisfies` checks the object against
 * `Operations<Caller>` and leaves its type as written, so each `status` stays the literal that selects
 * the response it belongs to, and both guards still see every key.
 *
 * Every kind of response the spec declares is returned here: an exact failure, a status inside a
 * range with its optional header, a status the `default` arm governs, a required header on a success,
 * two success statuses with different bodies, a bodyless `204`, text, image bytes as a stream - a
 * platform one, and one that is only a reader, as a backend's contract value is - and a model the
 * handler serialises to XML. An optional body is read as absent by leaving the key out.
 *
 * `WidgetTools_archive` answers bytes no tool result can carry, so the tool surface refuses it and the
 * HTTP surface serves it. It is still in this ONE object: `registerTools` accepts a handler for an
 * operation the document declares and the tool surface does not.
 */
const operations = {
	reindex: (_ctx: Caller, _input) => ({ status: 204 }),
	health: (ctx: Caller, _input) => ({ status: 200, body: { status: ctx.subject } }),
	WidgetTools_list: (_ctx: Caller, input) => ({
		status: 200,
		body: { items: [widget], total: input.limit ?? 1 },
		headers: { "x-total-count": 1 },
	}),
	WidgetTools_read: (_ctx: Caller, input) => {
		switch (input.widgetId) {
			case "missing":
				return { status: 404, body: { resource: input.widgetId } };
			case "busy":
				return { status: 429, body: { message: "slow down" }, headers: { "retry-after": 30 } };
			case "down":
				return { status: 503, body: { code: "down", message: "maintenance" } };
			default:
				return { status: 200, body: { ...widget, id: input.widgetId } };
		}
	},
	WidgetTools_create: (_ctx: Caller, input) =>
		input.name === widget.name
			? { status: 200, body: { id: widget.id } }
			: { status: 201, body: { id: "2", name: input.name, colour: input.colour } },
	WidgetTools_replace: (_ctx: Caller, input) => ({
		status: 200,
		body: { id: input.widgetId, name: input.name, colour: input.colour },
	}),
	WidgetTools_picture: (_ctx: Caller, input) =>
		input.widgetId === "missing"
			? { status: 404, body: { resource: input.widgetId } }
			: input.widgetId === "webp"
				? { status: 200, contentType: "image/webp", body: new ReadableStream<Uint8Array>() }
				: input.widgetId === "reader"
					? { status: 200, contentType: "image/png", body: reader }
					: { status: 200, contentType: "image/png", body: new ReadableStream<Uint8Array>() },
	WidgetTools_label: (_ctx: Caller, input) => ({ status: 200, body: `widget ${input.widgetId}` }),
	WidgetTools_asXml: (_ctx: Caller, input) => ({
		status: 200,
		body: `<widget><id>${input.widgetId}</id></widget>`,
	}),
	WidgetTools_archive: (_ctx: Caller, _input) => ({ status: 200, body: new Uint8Array([1, 2, 3]) }),
	WidgetTools_summaryAsText: (_ctx: Caller, input) => ({
		status: 200,
		body: `${input.widgetId} as ${input.accept}`,
	}),
	WidgetTools_summaryAsJson: (_ctx: Caller, input) => ({
		status: 200,
		body: { message: `${input.widgetId} as ${input.accept}` },
	}),
	WidgetTools_markSeen: (_ctx: Caller, input) =>
		"body" in input
			? { status: 200, body: { ...widget, id: input.widgetId, name: input.body.text } }
			: { status: 200, body: { ...widget, id: input.widgetId } },
	WidgetTools_remove: (_ctx: Caller, input) =>
		input.widgetId === "missing"
			? { status: 404, body: { resource: input.widgetId } }
			: { status: 204 },
} satisfies Operations<Caller>;

/** The HTTP surface. */
const app = new Hono<AppEnv>();
registerRoutes(app, () => operations, routeDeps);

/** The MCP surface, from the SAME object. */
registerTools(server, () => operations, toolDeps);

/**
 * **The type-level half, which the value-level half above cannot see.**
 *
 * One object satisfying both interfaces proves the object is assignable to each. It does NOT prove
 * the two interfaces are the same: a `Tools` whose input were *wider* than `Operations`' would still
 * accept this object while accepting values the HTTP surface refuses. `Identical<>` is invariant, so
 * it catches that, for the caller context, the input and every member of the result union.
 *
 * Note the trap the library's own docblock records: `Identical<A, B> & true` merely produces an odd
 * type. **Only a constraint violation is an error**, which is what `MustHold<T extends true>` is for.
 */
type Identical<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type MustHold<T extends true> = T;

/**
 * **Every operation is a tool but the one the tool surface refuses**, and that one is absent from
 * `Tools` rather than present with another signature. A refusal that left a key behind would let a
 * handler compile against a tool nobody registers.
 */
type Refused = "WidgetTools_archive";
type _Keys = MustHold<Identical<keyof Tools<Caller>, Exclude<keyof Operations<Caller>, Refused>>>;
type _Refused = MustHold<Identical<Extract<keyof Tools<Caller>, Refused>, never>>;
type _Reindex = MustHold<Identical<Tools<Caller>["reindex"], Operations<Caller>["reindex"]>>;
type _Health = MustHold<Identical<Tools<Caller>["health"], Operations<Caller>["health"]>>;
type _List = MustHold<
	Identical<Tools<Caller>["WidgetTools_list"], Operations<Caller>["WidgetTools_list"]>
>;
type _Read = MustHold<
	Identical<Tools<Caller>["WidgetTools_read"], Operations<Caller>["WidgetTools_read"]>
>;
type _Create = MustHold<
	Identical<Tools<Caller>["WidgetTools_create"], Operations<Caller>["WidgetTools_create"]>
>;
type _Replace = MustHold<
	Identical<Tools<Caller>["WidgetTools_replace"], Operations<Caller>["WidgetTools_replace"]>
>;
type _Picture = MustHold<
	Identical<Tools<Caller>["WidgetTools_picture"], Operations<Caller>["WidgetTools_picture"]>
>;
type _Label = MustHold<
	Identical<Tools<Caller>["WidgetTools_label"], Operations<Caller>["WidgetTools_label"]>
>;
type _AsXml = MustHold<
	Identical<Tools<Caller>["WidgetTools_asXml"], Operations<Caller>["WidgetTools_asXml"]>
>;
type _Remove = MustHold<
	Identical<Tools<Caller>["WidgetTools_remove"], Operations<Caller>["WidgetTools_remove"]>
>;
type _SummaryAsText = MustHold<
	Identical<
		Tools<Caller>["WidgetTools_summaryAsText"],
		Operations<Caller>["WidgetTools_summaryAsText"]
	>
>;
type _SummaryAsJson = MustHold<
	Identical<
		Tools<Caller>["WidgetTools_summaryAsJson"],
		Operations<Caller>["WidgetTools_summaryAsJson"]
	>
>;
type _MarkSeen = MustHold<
	Identical<Tools<Caller>["WidgetTools_markSeen"], Operations<Caller>["WidgetTools_markSeen"]>
>;
/** Each runtime declares the stream type itself, since neither imports the other; one type. */
type _OneByteStream = MustHold<Identical<ToolByteStream, ByteStream>>;

export type {
	_AsXml,
	_Create,
	_Health,
	_Keys,
	_Label,
	_List,
	_MarkSeen,
	_OneByteStream,
	_Picture,
	_Read,
	_Refused,
	_Reindex,
	_Remove,
	_Replace,
	_SummaryAsJson,
	_SummaryAsText,
};
export { app, operations };
