import {
	CancelTaskResultV2Schema,
	CreateTaskResultV2Schema,
	GetTaskResultV2Schema,
	UpdateTaskResultV2Schema,
} from "@modelcontextprotocol/ext-tasks/core/v2";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	type CreateTaskParams,
	declaresTasks,
	type DetailedTask,
	type ServerContext,
	type TaskAccess,
	TasksExtension,
	type TaskStore,
	toolError,
} from "../../src/runtime.js";

/**
 * **The Tasks extension, driven through the SDK's own request handling.**
 *
 * Every `tasks/*` answer here comes back over `createMcpHandler(...).fetch` as a 2026-07-28 request,
 * so the routing, the `Mcp-Name` header check and the error encoding are the SDK's, not a fake's.
 * Results are graded against `@modelcontextprotocol/ext-tasks`' published V2 wire schemas.
 */

const PROTOCOL = "2026-07-28";
const TASKS = "io.modelcontextprotocol/tasks";

/** A store that keeps tasks in a map and checks the principal on every read, as the contract asks. */
class MemoryStore implements TaskStore {
	readonly created: CreateTaskParams[] = [];
	readonly updates: { taskId: string; inputResponses: unknown }[] = [];
	readonly cancelled: string[] = [];
	readonly #tasks = new Map<string, { task: DetailedTask; principal: string | undefined }>();
	#next = 0;

	async create(params: CreateTaskParams) {
		this.created.push(params);
		const now = new Date(0).toISOString();
		const task = {
			taskId: `task-${++this.#next}`,
			status: "working" as const,
			createdAt: now,
			lastUpdatedAt: now,
			ttlMs: params.ttlMs,
			...(params.pollIntervalMs === undefined ? {} : { pollIntervalMs: params.pollIntervalMs }),
		};
		this.#tasks.set(task.taskId, { task, principal: params.principal });
		return task;
	}

	settle(taskId: string, task: DetailedTask) {
		const entry = this.#tasks.get(taskId);
		if (entry !== undefined) entry.task = task;
	}

	#find(taskId: string, access?: TaskAccess) {
		const entry = this.#tasks.get(taskId);
		return entry === undefined || entry.principal !== access?.principal ? undefined : entry;
	}

	async get(taskId: string, access?: TaskAccess) {
		return this.#find(taskId, access)?.task;
	}

	async update(taskId: string, inputResponses: Record<string, unknown>, access?: TaskAccess) {
		if (this.#find(taskId, access) === undefined) return false;
		this.updates.push({ taskId, inputResponses });
		return true;
	}

	async cancel(taskId: string, access?: TaskAccess) {
		if (this.#find(taskId, access) === undefined) return false;
		this.cancelled.push(taskId);
		return true;
	}
}

interface Answer {
	readonly status: number;
	readonly result?: Record<string, unknown>;
	readonly error?: { code: number; message: string; data?: unknown };
}

/**
 * One server per request, as `createMcpHandler` builds it, with the extension attached and one tool
 * that answers with a task whenever the request allows one.
 */
function serve(store: MemoryStore) {
	const tasks = new TasksExtension(store);
	const handler = createMcpHandler(() => {
		const server = new McpServer({ name: "tasks", version: "1.0.0" });
		tasks.attach(server);
		server.registerTool("export_catalog", { description: "Export the catalog." }, async (ctx) =>
			declaresTasks(ctx)
				? tasks.create(ctx, { context: { tool: "export_catalog" } })
				: { content: [{ type: "text", text: "exported inline" }] },
		);
		return server;
	});

	return async (
		method: string,
		params: Record<string, unknown>,
		options: { declare?: boolean; clientId?: string; legacy?: boolean } = {},
	): Promise<Answer> => {
		const meta = {
			"io.modelcontextprotocol/protocolVersion": PROTOCOL,
			"io.modelcontextprotocol/clientInfo": { name: "tasks", version: "0" },
			"io.modelcontextprotocol/clientCapabilities":
				options.declare === false ? {} : { extensions: { [TASKS]: {} } },
		};
		const routed = typeof params["taskId"] === "string" ? params["taskId"] : params["name"];
		const request = new Request("https://example.test/mcp", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				host: "example.test",
				"mcp-protocol-version": options.legacy === true ? "2025-11-25" : PROTOCOL,
				"mcp-method": method,
				...(typeof routed === "string" ? { "mcp-name": routed } : {}),
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method,
				params: options.legacy === true ? params : { ...params, _meta: meta },
			}),
		});
		const response = await handler.fetch(request, {
			authInfo: { token: "t", clientId: options.clientId ?? "reader", scopes: [] },
		});
		const text = await response.text();
		const body = JSON.parse(
			text.startsWith("event:") ? (/data: (.*)/.exec(text)?.[1] ?? "{}") : text,
		);
		return { status: response.status, ...body };
	};
}

/** A result without the `_meta` the SDK adds to every 2026-07-28 answer (its `serverInfo`). */
function withoutMeta(result: Record<string, unknown> | undefined): Record<string, unknown> {
	const { _meta: _ignored, ...rest } = result ?? {};
	return rest;
}

/** A context carrying only what `declaresTasks` and `create` read. */
function contextFor(declared: boolean): ServerContext {
	return {
		mcpReq: {
			method: "tools/call",
			envelope: {
				"io.modelcontextprotocol/clientCapabilities": declared
					? { extensions: { [TASKS]: {} } }
					: {},
			},
		},
		http: { authInfo: { token: "t", clientId: "reader", scopes: [] } },
	} as unknown as ServerContext;
}

describe("declaresTasks reads the request's own envelope", () => {
	it("is true only when this request declares the extension", () => {
		expect(declaresTasks(contextFor(true))).toBe(true);
		expect(declaresTasks(contextFor(false))).toBe(false);
		expect(declaresTasks({ mcpReq: { method: "tools/call" } } as unknown as ServerContext)).toBe(
			false,
		);
	});
});

describe("create answers a tool call with a task handle", () => {
	it("refuses a request that did not declare the extension with -32021", async () => {
		const store = new MemoryStore();
		await expect(new TasksExtension(store).create(contextFor(false))).rejects.toMatchObject({
			code: -32021,
		});
		expect(store.created).toEqual([]);
	});

	it("creates the task with the defaults and binds it to the caller", async () => {
		const store = new MemoryStore();
		const answer = await new TasksExtension(store).create(contextFor(true), {
			context: { tool: "export_catalog" },
		});
		expect(answer).toMatchObject({
			resultType: "task",
			taskId: "task-1",
			status: "working",
			ttlMs: 86_400_000,
			pollIntervalMs: 5000,
		});
		expect(CreateTaskResultV2Schema.safeParse(answer).success).toBe(true);
		expect(store.created).toEqual([
			{
				ttlMs: 86_400_000,
				pollIntervalMs: 5000,
				principal: "reader",
				context: { tool: "export_catalog" },
			},
		]);
	});

	it("binds to the client and the token subject when the verifier supplies one", async () => {
		const store = new MemoryStore();
		const context = contextFor(true) as unknown as {
			http: { authInfo: { extra?: Record<string, unknown> } };
		};
		context.http.authInfo.extra = { sub: "reader-7" };
		await new TasksExtension(store).create(context as unknown as ServerContext);
		expect(store.created[0]?.principal).toBe(JSON.stringify(["reader", "reader-7"]));
	});
});

describe("tasks/* over the wire", () => {
	it("answers a declaring tools/call with a task, and tasks/get with its state", async () => {
		const store = new MemoryStore();
		const rpc = serve(store);
		const created = await rpc("tools/call", { name: "export_catalog", arguments: {} });
		expect(created.result).toMatchObject({ resultType: "task", taskId: "task-1" });

		const polled = await rpc("tasks/get", { taskId: "task-1" });
		expect(polled.result).toMatchObject({
			resultType: "complete",
			taskId: "task-1",
			status: "working",
		});
		expect(GetTaskResultV2Schema.safeParse(polled.result).success).toBe(true);

		store.settle("task-1", {
			taskId: "task-1",
			status: "completed",
			createdAt: new Date(0).toISOString(),
			lastUpdatedAt: new Date(1).toISOString(),
			ttlMs: 86_400_000,
			result: { content: [{ type: "text", text: "done" }] },
		});
		const done = await rpc("tasks/get", { taskId: "task-1" });
		expect(done.result).toMatchObject({
			resultType: "complete",
			status: "completed",
			result: { content: [{ type: "text", text: "done" }] },
		});
		expect(GetTaskResultV2Schema.safeParse(done.result).success).toBe(true);
	});

	it("answers a client that did not declare the extension inline, never with a task", async () => {
		const rpc = serve(new MemoryStore());
		const answer = await rpc(
			"tools/call",
			{ name: "export_catalog", arguments: {} },
			{ declare: false },
		);
		expect(answer.result).not.toHaveProperty("resultType", "task");
		expect(answer.result).toMatchObject({ content: [{ type: "text", text: "exported inline" }] });
	});

	it("answers an unknown task, and another caller's task, with the same -32602", async () => {
		const rpc = serve(new MemoryStore());
		await rpc("tools/call", { name: "export_catalog", arguments: {} });
		const unknown = await rpc("tasks/get", { taskId: "task-404" });
		const foreign = await rpc("tasks/get", { taskId: "task-1" }, { clientId: "intruder" });
		expect(unknown.error).toMatchObject({ code: -32602, message: "Task not found" });
		expect(foreign.error).toEqual(unknown.error);
		for (const method of ["tasks/update", "tasks/cancel"]) {
			const refused = await rpc(
				method,
				{ taskId: "task-1", inputResponses: {} },
				{ clientId: "intruder" },
			);
			expect(refused.error).toMatchObject({ code: -32602 });
		}
	});

	it("refuses every tasks/* method to a request that did not declare the extension", async () => {
		const rpc = serve(new MemoryStore());
		await rpc("tools/call", { name: "export_catalog", arguments: {} });
		for (const method of ["tasks/get", "tasks/update", "tasks/cancel"]) {
			const refused = await rpc(
				method,
				{ taskId: "task-1", inputResponses: {} },
				{ declare: false },
			);
			expect(refused.error).toMatchObject({
				code: -32021,
				data: { requiredCapabilities: { extensions: { [TASKS]: {} } } },
			});
		}
	});

	it("delivers input responses and acknowledges with an empty result", async () => {
		const store = new MemoryStore();
		const rpc = serve(store);
		await rpc("tools/call", { name: "export_catalog", arguments: {} });
		const answer = await rpc("tasks/update", {
			taskId: "task-1",
			inputResponses: { confirm: { action: "accept", content: {} } },
		});
		expect(withoutMeta(answer.result)).toEqual({ resultType: "complete" });
		expect(UpdateTaskResultV2Schema.safeParse(answer.result).success).toBe(true);
		expect(store.updates).toEqual([
			{ taskId: "task-1", inputResponses: { confirm: { action: "accept", content: {} } } },
		]);
	});

	it("acknowledges a cancel with an empty result", async () => {
		const store = new MemoryStore();
		const rpc = serve(store);
		await rpc("tools/call", { name: "export_catalog", arguments: {} });
		const answer = await rpc("tasks/cancel", { taskId: "task-1" });
		expect(withoutMeta(answer.result)).toEqual({ resultType: "complete" });
		expect(CancelTaskResultV2Schema.safeParse(answer.result).success).toBe(true);
		expect(store.cancelled).toEqual(["task-1"]);
	});

	it("answers tasks/* on 2025-11-25, where those names meant other methods, as not found", async () => {
		const rpc = serve(new MemoryStore());
		const answer = await rpc("tasks/get", { taskId: "task-1" }, { legacy: true });
		expect(answer.error).toMatchObject({ code: -32601 });
	});

	it("advertises the extension in server/discover", async () => {
		const rpc = serve(new MemoryStore());
		const discovered = await rpc("server/discover", {});
		expect(discovered.result).toMatchObject({ capabilities: { extensions: { [TASKS]: {} } } });
	});
});

describe("attach", () => {
	it("does nothing when the same extension is attached to a server again", () => {
		const server = new McpServer({ name: "tasks", version: "1.0.0" });
		const tasks = new TasksExtension(new MemoryStore());
		tasks.attach(server);
		expect(() => tasks.attach(server)).not.toThrow();
	});

	it("refuses a server that already answers a tasks/* method, and leaves it as it was", () => {
		const server = new McpServer({ name: "tasks", version: "1.0.0" });
		server.server.setRequestHandler(
			"tasks/get",
			{ params: z.object({ taskId: z.string() }) },
			() => ({}),
		);
		expect(() => new TasksExtension(new MemoryStore()).attach(server)).toThrow(/already exists/);
		expect(server.server.getCapabilities().extensions).toBeUndefined();
	});

	it("refuses a second Tasks extension on one server, which would silently replace the first", () => {
		const server = new McpServer({ name: "tasks", version: "1.0.0" });
		new TasksExtension(new MemoryStore()).attach(server);
		expect(() => new TasksExtension(new MemoryStore()).attach(server)).toThrow(/already/);
	});
});

describe("toolError is the result McpServer makes of a thrown error", () => {
	it("is a text block carrying the message, marked as an error", () => {
		expect(toolError(new Error("the export failed"))).toEqual({
			content: [{ type: "text", text: "the export failed" }],
			isError: true,
		});
		expect(toolError("plain")).toEqual({
			content: [{ type: "text", text: "plain" }],
			isError: true,
		});
	});
});
