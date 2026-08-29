/**
 * **The claim this package exists to make, written as an application would write it.**
 *
 * ONE handler object, passed to BOTH generated surfaces. If the two emitters ever derive a different
 * signature for the same operation, this file stops compiling -- which is the only check that can
 * see it, because the two are separate packages deriving the same thing by the same rules.
 *
 * Excluded from `pnpm typecheck` by `tsconfig.json` (`**\/*.fixture.ts`): it imports from a
 * gitignored output directory, so checking it there would make a fresh clone fail before its first
 * build. `agreement.test.ts` compiles it against freshly emitted output instead, which cannot go
 * stale.
 *
 * **Every line below is load-bearing.** See the docblocks.
 */
import { Hono } from "hono";
import type { McpServer } from "@modelcontextprotocol/server";
import { registerRoutes, type Operations } from "./.out/agreement/app.gen.js";
import { registerTools, type Tools } from "./.out/agreement/mcp.gen.js";
import type { AppEnv, Ctx, RouteDeps, ToolDeps } from "./runtime.js";

declare const routeDeps: RouteDeps;
declare const toolDeps: ToolDeps;
declare const server: McpServer;

const widget = { id: "1", name: "a", colour: "grey" };

/**
 * **UNANNOTATED, deliberately.**
 *
 * Annotating this widens the value to the annotation, `T` then infers as that annotation,
 * `Exclude<keyof T, DeclaredOperationId>` collapses to `never`, and the surplus-key guard in BOTH
 * `registerRoutes` and `registerTools` evaporates. Measured in the sibling package: a handler for an
 * operation the spec no longer declares produced no error at all through the annotated form.
 */
const operations = {
	reindex: (_ctx: Ctx, _input: Record<string, never>) => undefined,
	health: (_ctx: Ctx, _input: Record<string, never>) => ({ status: "ok" }),
	WidgetTools_list: (_ctx: Ctx, input: { limit?: number | undefined }) => ({
		items: [widget],
		total: input.limit ?? 1,
	}),
	WidgetTools_read: (_ctx: Ctx, input: { widgetId: string }) => ({ ...widget, id: input.widgetId }),
	WidgetTools_create: (_ctx: Ctx, input: { name: string; colour: string }) => ({
		id: "1",
		name: input.name,
		colour: input.colour,
	}),
	WidgetTools_replace: (_ctx: Ctx, input: { widgetId: string; name: string; colour: string }) => ({
		id: input.widgetId,
		name: input.name,
		colour: input.colour,
	}),
	WidgetTools_remove: (_ctx: Ctx, _input: { widgetId: string }) => undefined,
};

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
 * it catches that.
 *
 * Note the trap the library's own docblock records: `Identical<A, B> & true` merely produces an odd
 * type. **Only a constraint violation is an error**, which is what `MustHold<T extends true>` is for.
 */
type Identical<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type MustHold<T extends true> = T;

type _Keys = MustHold<Identical<keyof Tools, keyof Operations>>;
type _Reindex = MustHold<Identical<Tools["reindex"], Operations["reindex"]>>;
type _Health = MustHold<Identical<Tools["health"], Operations["health"]>>;
type _List = MustHold<Identical<Tools["WidgetTools_list"], Operations["WidgetTools_list"]>>;
type _Read = MustHold<Identical<Tools["WidgetTools_read"], Operations["WidgetTools_read"]>>;
type _Create = MustHold<Identical<Tools["WidgetTools_create"], Operations["WidgetTools_create"]>>;
type _Replace = MustHold<
	Identical<Tools["WidgetTools_replace"], Operations["WidgetTools_replace"]>
>;
type _Remove = MustHold<Identical<Tools["WidgetTools_remove"], Operations["WidgetTools_remove"]>>;

export type { _Create, _Health, _Keys, _List, _Read, _Reindex, _Remove, _Replace };
export { app, operations };
