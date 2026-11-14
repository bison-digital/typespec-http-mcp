import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	CallToolResultV2Schema,
	CreateTaskResultV2Schema,
	GetTaskResultV2Schema,
} from "@modelcontextprotocol/ext-tasks/core/v2";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type {
	CreateTaskParams,
	DetailedTask,
	TaskAccess,
	TaskStore,
	TaskToolResult,
} from "../../src/runtime.js";
import { compileFixture } from "../support/compile-fixture.js";
import { typecheckEmitted } from "../support/typecheck-emitted.js";

/**
 * **Tools answering with MCP tasks, configured only where the application wires them.**
 *
 * The bookshop spec says nothing about tasks. Every behaviour below comes from `deps.tasks`, driven
 * through emitted output and the emitted runtime's `TasksExtension`, over `createMcpHandler(...).fetch`
 * with real 2026-07-28 requests.
 */

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const PROTOCOL = "2026-07-28";
const TASKS = "io.modelcontextprotocol/tasks";
const SERVER_INFO = "io.modelcontextprotocol/serverInfo";

interface Call {
	readonly operationId: string;
	readonly input: unknown;
}

interface Generated {
	readonly registerTools: (
		server: McpServer,
		handlersFor: (context: unknown) => Record<string, unknown>,
		deps: Record<string, unknown>,
	) => readonly string[];
	readonly runTool: (
		handlers: Record<string, unknown>,
		call: Call,
		caller: unknown,
	) => Promise<Record<string, unknown>>;
}

interface EmittedRuntime {
	readonly TasksExtension: new (store: TaskStore) => {
		create(
			context: unknown,
			options?: { context?: Record<string, unknown> },
		): Promise<TaskToolResult>;
		attach(server: McpServer): void;
	};
}

let generated: Generated;
let runtime: EmittedRuntime;
let outDir: string;

beforeAll(async () => {
	const compiled = await compileFixture(join(packageRoot, "test", "tasks"), "service", {
		outName: "tasks",
	});
	expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	outDir = compiled.outDir;
	generated = (await import(join(outDir, "mcp.gen.ts"))) as unknown as Generated;
	runtime = (await import(join(outDir, "mcp-runtime.gen.ts"))) as unknown as EmittedRuntime;
}, 300_000);

class MemoryStore implements TaskStore {
	readonly created: CreateTaskParams[] = [];
	readonly #tasks = new Map<string, { task: DetailedTask; principal: string | undefined }>();

	async create(params: CreateTaskParams) {
		this.created.push(params);
		const task = {
			taskId: `export-${this.created.length}`,
			status: "working" as const,
			createdAt: new Date(0).toISOString(),
			lastUpdatedAt: new Date(0).toISOString(),
			ttlMs: params.ttlMs,
		};
		this.#tasks.set(task.taskId, { task, principal: params.principal });
		return task;
	}

	complete(taskId: string, result: Record<string, unknown>) {
		const entry = this.#tasks.get(taskId);
		if (entry !== undefined) entry.task = { ...entry.task, status: "completed", result };
	}

	async get(taskId: string, access?: TaskAccess) {
		const entry = this.#tasks.get(taskId);
		return entry?.principal === access?.principal ? entry?.task : undefined;
	}

	async update() {
		return false;
	}

	async cancel() {
		return false;
	}
}

/** What exporting does this time. Each test sets it. */
let exporting: () => unknown = () => ({
	status: 200,
	body: { url: "https://example.test/c.csv", titles: 3 },
});
const exportCalls = vi.fn();

const handlers = {
	getBook: (_caller: unknown, input: { bookId: string }) => ({
		status: 200,
		body: { id: input.bookId, title: "The Left Hand of Darkness" },
	}),
	exportCatalog: (caller: unknown, input: unknown) => {
		exportCalls(caller, input);
		return exporting();
	},
};

const CALLER = { reader: "shop-front" };

interface Answer {
	readonly result?: Record<string, unknown>;
	readonly error?: { code: number; message: string };
}

/**
 * A deployment: the generated tools, the extension over `store`, and the task policy under test.
 * `tasks: undefined` is an application that configures none.
 */
function deploy(
	store: MemoryStore,
	tasks:
		| ((extension: InstanceType<EmittedRuntime["TasksExtension"]>) => Record<string, unknown>)
		| undefined,
) {
	const extension = new runtime.TasksExtension(store);
	const handler = createMcpHandler(() => {
		const server = new McpServer({ name: "bookshop", version: "1.0.0" });
		if (tasks !== undefined) extension.attach(server);
		generated.registerTools(server, () => handlers, {
			permits: () => true,
			context: () => CALLER,
			noContext: () => ({ content: [{ type: "text", text: "no caller" }], isError: true }),
			...(tasks === undefined ? {} : { tasks: tasks(extension) }),
		});
		return server;
	});

	return async (
		method: string,
		params: Record<string, unknown>,
		options: { declare?: boolean } = {},
	): Promise<Answer> => {
		const meta = {
			"io.modelcontextprotocol/protocolVersion": PROTOCOL,
			"io.modelcontextprotocol/clientInfo": { name: "bookshop-client", version: "0" },
			"io.modelcontextprotocol/clientCapabilities":
				options.declare === false ? {} : { extensions: { [TASKS]: {} } },
		};
		const routed = typeof params["taskId"] === "string" ? params["taskId"] : params["name"];
		const response = await handler.fetch(
			new Request("https://example.test/mcp", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "application/json, text/event-stream",
					host: "example.test",
					"mcp-protocol-version": PROTOCOL,
					"mcp-method": method,
					...(typeof routed === "string" ? { "mcp-name": routed } : {}),
				},
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: meta } }),
			}),
			{ authInfo: { token: "t", clientId: "shop-front", scopes: [] } },
		);
		return JSON.parse(await response.text()) as Answer;
	};
}

/**
 * The tool's answer as a completed task carries it: everything the blocking call answered, its
 * `resultType: "complete"` included, but not the `serverInfo` the SDK adds to the envelope of every
 * response, which describes the server rather than the call.
 */
function asProduced(result: Record<string, unknown> | undefined): Record<string, unknown> {
	const { _meta, ...rest } = result ?? {};
	const meta = { ...(_meta as Record<string, unknown> | undefined) };
	delete meta[SERVER_INFO];
	return Object.keys(meta).length === 0 ? rest : { ...rest, _meta: meta };
}

/** The body's fields are the tool's arguments, flat, and the handler receives them as they arrive. */
const EXPORT = { name: "exportCatalog", arguments: { format: "csv" } };
const EXPORT_CALL = { operationId: "exportCatalog", input: { format: "csv" } };

/** The policy most applications write: list the operation, and keep the call as the store context. */
const listingExport =
	(extra: Record<string, unknown> = {}) =>
	(extension: InstanceType<EmittedRuntime["TasksExtension"]>) => ({
		operations: ["exportCatalog"],
		create: (call: Call, _caller: unknown, context: unknown) =>
			extension.create(context, { context: { ...call } }),
		...extra,
	});

describe("a listed tool answers a request that declared the extension with a task", () => {
	it("creates the task through the application's policy, without running the handler", async () => {
		exportCalls.mockClear();
		const store = new MemoryStore();
		const answer = await deploy(store, listingExport())("tools/call", EXPORT);
		expect(answer.result).toMatchObject({
			resultType: "task",
			taskId: "export-1",
			status: "working",
		});
		expect(CreateTaskResultV2Schema.safeParse(answer.result).success).toBe(true);
		expect(store.created).toEqual([
			{ ttlMs: 86_400_000, pollIntervalMs: 5000, principal: "shop-front", context: EXPORT_CALL },
		]);
		expect(exportCalls).not.toHaveBeenCalled();
	});

	it("runs inline when the policy decides so, and passes it the call and the caller", async () => {
		exporting = () => ({ status: 200, body: { url: "https://example.test/c.csv", titles: 3 } });
		const decide = vi.fn(() => "inline");
		const store = new MemoryStore();
		const answer = await deploy(store, listingExport({ decide }))("tools/call", EXPORT);
		expect(answer.result).not.toHaveProperty("resultType", "task");
		expect(asProduced(answer.result)).toEqual({
			content: [{ type: "text", text: '{"url":"https://example.test/c.csv","titles":3}' }],
			resultType: "complete",
		});
		expect(decide).toHaveBeenCalledWith(EXPORT_CALL, CALLER, expect.anything());
		expect(store.created).toEqual([]);
	});
});

describe("never a task where the extension forbids one or the application did not ask", () => {
	it("answers a request that did not declare the extension inline, without consulting the policy", async () => {
		exporting = () => ({ status: 200, body: { url: "https://example.test/c.csv", titles: 3 } });
		const decide = vi.fn(() => "task");
		const store = new MemoryStore();
		const answer = await deploy(store, listingExport({ decide }))("tools/call", EXPORT, {
			declare: false,
		});
		expect(answer.result).not.toHaveProperty("resultType", "task");
		expect(answer.result).toMatchObject({ content: [{ type: "text" }] });
		expect(decide).not.toHaveBeenCalled();
		expect(store.created).toEqual([]);
	});

	it("answers an unlisted tool inline", async () => {
		const store = new MemoryStore();
		const answer = await deploy(store, listingExport())("tools/call", {
			name: "getBook",
			arguments: { bookId: "b1" },
		});
		expect(answer.result).not.toHaveProperty("resultType", "task");
		expect(answer.result).toMatchObject({
			structuredContent: { id: "b1", title: "The Left Hand of Darkness" },
		});
		expect(store.created).toEqual([]);
	});
});

describe("what a listed tool publishes", () => {
	const outputSchemas = async (rpc: ReturnType<typeof deploy>) => {
		const listed = (await rpc("tools/list", {})).result as {
			tools: { name: string; outputSchema?: unknown }[];
		};
		return Object.fromEntries(
			listed.tools.map((tool) => [tool.name, tool.outputSchema !== undefined]),
		);
	};

	it("withholds outputSchema from the listed tool only, since a task tool cannot publish one", async () => {
		expect(await outputSchemas(deploy(new MemoryStore(), listingExport()))).toEqual({
			exportCatalog: false,
			getBook: true,
		});
		expect(await outputSchemas(deploy(new MemoryStore(), undefined))).toEqual({
			exportCatalog: true,
			getBook: true,
		});
	});

	it("changes nothing when the policy lists no operation", async () => {
		const none = deploy(new MemoryStore(), (extension) => ({
			operations: [],
			create: (call: Call, _caller: unknown, context: unknown) =>
				extension.create(context, { context: { ...call } }),
		}));
		const without = deploy(new MemoryStore(), undefined);
		exporting = () => ({ status: 200, body: { url: "https://example.test/c.csv", titles: 3 } });
		for (const [method, params] of [
			["tools/list", {}],
			["tools/call", EXPORT],
			["tools/call", { name: "getBook", arguments: { bookId: "b1" } }],
		] as const) {
			expect(asProduced((await none(method, params)).result)).toEqual(
				asProduced((await without(method, params)).result),
			);
		}
	});
});

describe("runTool settles a task with exactly what the blocking call answers", () => {
	const outcomes: readonly [string, () => unknown][] = [
		["a success", () => ({ status: 200, body: { url: "https://example.test/c.csv", titles: 3 } })],
		[
			"a declared failure",
			() => ({ status: 404, body: { code: "missing", message: "No catalogue." } }),
		],
		["a status the document does not declare", () => ({ status: 418, body: {} })],
		["a body that breaks its schema", () => ({ status: 200, body: { url: 7 } })],
		[
			"a thrown error",
			() => {
				throw new Error("the warehouse is offline");
			},
		],
	];

	for (const [name, outcome] of outcomes) {
		it(`agrees for ${name}`, async () => {
			exporting = outcome;
			const blocking = await deploy(new MemoryStore(), listingExport())("tools/call", EXPORT, {
				declare: false,
			});
			const settled = await generated.runTool(handlers, EXPORT_CALL, CALLER);
			expect(settled).toEqual(asProduced(blocking.result));
			// What the Tasks extension's reference client decodes a completed task's result with.
			expect(CallToolResultV2Schema.safeParse(settled).success).toBe(true);
		});
	}

	it("serves the settled result through tasks/get", async () => {
		exporting = () => ({ status: 200, body: { url: "https://example.test/c.csv", titles: 3 } });
		const store = new MemoryStore();
		const rpc = deploy(store, listingExport());
		const created = await rpc("tools/call", EXPORT);
		const taskId = String(created.result?.["taskId"]);

		const work = store.created[0]?.context as unknown as Call;
		store.complete(taskId, await generated.runTool(handlers, work, CALLER));

		const polled = await rpc("tasks/get", { taskId });
		expect(GetTaskResultV2Schema.safeParse(polled.result).success).toBe(true);
		const blocking = await rpc("tools/call", EXPORT, { declare: false });
		expect(polled.result).toMatchObject({
			resultType: "complete",
			status: "completed",
			result: asProduced(blocking.result),
		});
	});
});

describe("what the generated code refuses rather than gets wrong", () => {
	it("refuses a call for an operation this module does not have, so the store can fail the task", async () => {
		await expect(
			generated.runTool(handlers, { operationId: "deleteCatalog", input: {} }, CALLER),
		).rejects.toThrow(/deleteCatalog/);
	});

	it("refuses stored input its tool's schema no longer accepts, without running the handler", async () => {
		exportCalls.mockClear();
		await expect(
			generated.runTool(
				handlers,
				{ operationId: "exportCatalog", input: { format: "xml" } },
				CALLER,
			),
		).rejects.toThrow(/exportCatalog/);
		expect(exportCalls).not.toHaveBeenCalled();
	});

	it("refuses a task policy on a server the Tasks extension is not attached to", () => {
		const server = new McpServer({ name: "bookshop", version: "1.0.0" });
		const extension = new runtime.TasksExtension(new MemoryStore());
		expect(() =>
			generated.registerTools(server, () => handlers, {
				permits: () => true,
				context: () => CALLER,
				noContext: () => ({ content: [], isError: true }),
				tasks: listingExport()(extension),
			}),
		).toThrow(/attach/);
	});
});

describe("the policy is typed by the generated tools", () => {
	it("accepts the wiring the documentation shows and refuses an operation that is not a tool", () => {
		writeFileSync(
			join(outDir, "consumer.ts"),
			`import { McpServer } from "@modelcontextprotocol/server";
import { registerTools, runTool, type Tools, type ToolCall } from "./mcp.gen.js";
import { TasksExtension, type TaskStore, type ToolDeps } from "./mcp-runtime.gen.js";

interface Caller {
	readonly id: string;
}
declare const store: TaskStore;
declare const handlers: Tools<Caller>;

const tasks = new TasksExtension(store);
const deps: ToolDeps<Caller, ToolCall> = {
	permits: () => true,
	context: () => ({ id: "shop-front" }),
	noContext: () => ({ content: [], isError: true }),
	tasks: {
		operations: ["exportCatalog"],
		decide: (call) => (call.operationId === "exportCatalog" ? "task" : "inline"),
		create: (call, caller, context) => tasks.create(context, { context: { ...call, caller: caller.id } }),
	},
};
const server = new McpServer({ name: "bookshop", version: "1.0.0" });
tasks.attach(server);
registerTools(server, () => handlers, deps);
export const settled = runTool(handlers, { operationId: "exportCatalog", input: { format: "csv" } }, { id: "shop-front" });

export const refused: ToolDeps<Caller, ToolCall>["tasks"] = {
	// @ts-expect-error -- not an operation of this service
	operations: ["deleteCatalog"],
	create: (_call, _caller, context) => tasks.create(context),
};
`,
		);
		const { output, failed } = typecheckEmitted(outDir);
		expect(output).toBe("");
		expect(failed).toBe(false);
	});
});
