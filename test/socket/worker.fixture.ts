/**
 * **The wiring `docs/guides.md` documents, as a Worker, so the documentation is graded by running.**
 *
 * Every other arm in this package runs in Node against a `Request` this repository constructed. This
 * file is bundled by esbuild, served by workerd, and driven by the official MCP client over a real
 * socket -- which is the only place four things can be checked at all: that emitted output survives
 * bundling, that it runs on the runtime it is written for, that the protocol headers a real client
 * writes are the ones the surface expects, and that ONE server answers different callers
 * differently.
 *
 * Excluded from `pnpm typecheck` by `tsconfig.json` (`**\/*.fixture.ts`): it imports from a
 * gitignored output directory, so checking it there would make a fresh clone fail before its first
 * build. `socket.test.ts` compiles it against freshly emitted output instead.
 */
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { registerTools, runTool, type ToolCall, type Tools } from "./.out/socket/mcp.gen.js";
import {
	type CreateTaskParams,
	type DetailedTask,
	type Task,
	type TaskAccess,
	TasksExtension,
	type TaskStore,
	type ToolDeps,
} from "./.out/socket/mcp-runtime.gen.js";

/**
 * The same handler object an HTTP server would be given. **`satisfies`, not an annotation**, so each
 * `status` stays the literal that selects its response and `registerTools` still sees every key.
 */
const widget = { id: "1", name: "a", colour: "grey" };

/** The caller `deps.context` establishes, carrying the `authentication` the generated call passed. */
interface Caller {
	readonly caller: "anonymous" | "granted";
	readonly authentication: "none" | "optional" | "required";
}

const handlers = {
	health: (ctx) => ({ status: 200, body: { status: "ok", authentication: ctx.authentication } }),
	whoami: (ctx) => ({
		status: 200,
		body: { caller: ctx.caller, authentication: ctx.authentication },
	}),
	WidgetTools_list: (ctx) => ({
		status: 200,
		body: { items: [widget], total: 1, authentication: ctx.authentication },
	}),
	WidgetTools_read: (_ctx, input) =>
		input.widgetId === "missing"
			? { status: 404, body: { code: "missing", message: "No widget has that identifier." } }
			: { status: 200, body: widget },
	WidgetTools_create: () => ({ status: 200, body: widget }),
	WidgetTools_remove: () => ({ status: 204 }),
} satisfies Tools<Caller>;

/**
 * The Durable Object surface the store below uses, declared here so the Worker builds without a
 * types package: the storage it keeps tasks in, the alarm that runs their work, and the namespace
 * the Worker reaches it through.
 */
interface TaskStorage {
	get<T>(key: string): Promise<T | undefined>;
	put(key: string, value: unknown): Promise<void>;
	list<T>(options: { prefix: string }): Promise<Map<string, T>>;
	setAlarm(scheduledTime: number): Promise<void>;
}
interface TaskObjectNamespace {
	idFromName(name: string): unknown;
	get(id: unknown): { fetch(request: Request): Promise<Response> };
}
interface Env {
	readonly TASKS: TaskObjectNamespace;
}

interface StoredTask {
	readonly task: DetailedTask;
	readonly principal: string | null;
	readonly work: { readonly call: ToolCall; readonly caller: Caller };
}

/** How long a task's work waits for the alarm: long enough to restart the Worker first. */
const WORK_DELAY_MS = 1500;

/**
 * **The store a deployment writes: tasks kept in a Durable Object, and their work run by its alarm.**
 *
 * A task outlives the request, the server and the Worker that created it, and its work runs whether
 * or not anyone is polling. The work is the generated `runTool`, so a task completes with exactly
 * what the tool answers; the store owns where the task lives and when its work runs.
 */
export class TaskStoreObject {
	readonly #storage: TaskStorage;

	constructor(state: { readonly storage: TaskStorage }) {
		this.#storage = state.storage;
	}

	async fetch(request: Request): Promise<Response> {
		const asked = (await request.json()) as {
			readonly op: "create" | "get" | "update" | "cancel";
			readonly taskId?: string;
			readonly principal: string | null;
			readonly params?: CreateTaskParams;
		};
		if (asked.op === "create" && asked.params !== undefined) {
			const now = new Date().toISOString();
			const task = {
				taskId: crypto.randomUUID(),
				status: "working" as const,
				createdAt: now,
				lastUpdatedAt: now,
				ttlMs: asked.params.ttlMs,
				pollIntervalMs: 250,
			};
			const work = asked.params.context as unknown as StoredTask["work"];
			await this.#storage.put(`task:${task.taskId}`, { task, principal: asked.principal, work });
			await this.#storage.setAlarm(Date.now() + WORK_DELAY_MS);
			return Response.json(task);
		}
		const key = `task:${asked.taskId ?? ""}`;
		const stored = await this.#storage.get<StoredTask>(key);
		// Another principal's task is answered exactly as an unknown one.
		const found = stored !== undefined && stored.principal === asked.principal ? stored : undefined;
		if (asked.op === "get") return Response.json(found?.task ?? null);
		if (found !== undefined && asked.op === "cancel" && found.task.status === "working") {
			const now = new Date().toISOString();
			await this.#storage.put(key, {
				...found,
				task: { ...found.task, status: "cancelled", lastUpdatedAt: now },
			});
		}
		return Response.json(found !== undefined);
	}

	/** Runs every task still working, and records what it answered. */
	async alarm(): Promise<void> {
		for (const [key, stored] of await this.#storage.list<StoredTask>({ prefix: "task:" })) {
			if (stored.task.status !== "working") continue;
			const result = await runTool(handlers, stored.work.call, stored.work.caller);
			const now = new Date().toISOString();
			await this.#storage.put(key, {
				...stored,
				task: { ...stored.task, status: "completed", lastUpdatedAt: now, result: { ...result } },
			});
		}
	}
}

/** The runtime's `TaskStore`, answered by the Durable Object above. */
class DurableTaskStore implements TaskStore {
	readonly #namespace: TaskObjectNamespace;

	constructor(namespace: TaskObjectNamespace) {
		this.#namespace = namespace;
	}

	async #ask<T>(asked: Record<string, unknown>, access?: TaskAccess): Promise<T> {
		const object = this.#namespace.get(this.#namespace.idFromName("tasks"));
		const response = await object.fetch(
			new Request("https://tasks.invalid/", {
				method: "POST",
				body: JSON.stringify({ ...asked, principal: access?.principal ?? null }),
			}),
		);
		return (await response.json()) as T;
	}

	create(params: CreateTaskParams) {
		return this.#ask<Task>(
			{ op: "create", params },
			params.principal === undefined ? {} : { principal: params.principal },
		);
	}

	async get(taskId: string, access?: TaskAccess) {
		return (await this.#ask<DetailedTask | null>({ op: "get", taskId }, access)) ?? undefined;
	}

	update(taskId: string, _inputResponses: Readonly<Record<string, unknown>>, access?: TaskAccess) {
		return this.#ask<boolean>({ op: "update", taskId }, access);
	}

	cancel(taskId: string, access?: TaskAccess) {
		return this.#ask<boolean>({ op: "cancel", taskId }, access);
	}
}

/**
 * ONE extension for the deployment, made on the first request, because the store needs the
 * environment and only a request carries it. The factory below builds a server per request.
 */
let tasks: TasksExtension | undefined;
function extension(): TasksExtension {
	if (tasks === undefined) throw new Error("The Tasks extension is made by the first request.");
	return tasks;
}

/**
 * Three callers, one deployment.
 *
 * **This is the shape the in-process arm cannot have.** `acceptance.test.ts` builds a NEW handler
 * per RPC, closing over the grant, so it cannot tell a per-request `deps` from a per-handler one --
 * the trap it is credited with catching. Here the handler is built once, at module scope, and the
 * grant arrives only on the request.
 */
const GRANTS: Record<string, { schemes: readonly string[]; scopes: readonly string[] }> = {
	"reader-token": { schemes: ["OAuth2Auth"], scopes: ["widgets.read"] },
	"writer-token": { schemes: ["OAuth2Auth"], scopes: ["widgets.read", "widgets.write"] },
	"nobody-token": { schemes: [], scopes: [] },
};
const NO_GRANT = { schemes: [], scopes: [] } as const;

/**
 * **The factory runs PER REQUEST and receives that request's verified identity**, so `deps` is built
 * here rather than once at module scope. Built once, `permits` would close over no caller and every
 * client would see an identical tool list.
 */
const handler = createMcpHandler(
	(context: { authInfo?: { scopes?: string[]; extra?: Record<string, unknown> } }) => {
		const scopes = context.authInfo?.scopes ?? [];
		const schemes = (context.authInfo?.extra?.["schemes"] as readonly string[] | undefined) ?? [];

		const deps: ToolDeps<Caller, ToolCall> = {
			permits: (requirements) =>
				requirements.length === 0 ||
				requirements.some((requirement) =>
					Object.entries(requirement).every(
						([scheme, needed]) =>
							schemes.includes(scheme) && needed.every((scope) => scopes.includes(scope)),
					),
				),
			context: (_context, authentication) => ({
				caller: scopes.length > 0 ? "granted" : "anonymous",
				authentication,
			}),
			noContext: () => ({ content: [{ type: "text", text: "Not authenticated." }], isError: true }),
			// Creating a widget may answer a client that declared the Tasks extension with a task.
			tasks: {
				operations: ["WidgetTools_create"],
				create: (call, caller, context) =>
					extension().create(context, { context: { call, caller } }),
			},
		};

		const server = new McpServer({ name: "widgets", version: "1.0.0" });
		extension().attach(server);
		registerTools(server, () => handlers, deps);
		return server;
	},
);

/**
 * `createMcpHandler` returns an OBJECT with a `fetch` method, not a callable. Calling the returned
 * value directly is the shape of Cloudflare's `agents` wrapper and gives
 * `TypeError: handler is not a function`.
 */
export default {
	fetch(request: Request, env: Env): Promise<Response> {
		tasks ??= new TasksExtension(new DurableTaskStore(env.TASKS));
		const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
		const grant = GRANTS[token] ?? NO_GRANT;
		return handler.fetch(request, {
			authInfo: {
				token,
				clientId: "socket",
				scopes: [...grant.scopes],
				extra: { schemes: [...grant.schemes] },
			},
		});
	},
};
