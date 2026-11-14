import { execFile } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
	CreateTaskParams,
	DetailedTask,
	TaskAccess,
	TaskStore,
	TaskToolResult,
} from "../../src/runtime.js";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **The Tasks extension as the official conformance suite grades it.**
 *
 * `@modelcontextprotocol/conformance` connects to a running server as an MCP client and checks it
 * against the extension's specification. The server here is the generated tools of
 * `tasks-extension.tsp`, wired as the documentation describes: the emitted runtime's
 * `TasksExtension`, a store, and a task policy. The store runs each task's work on a timer and
 * settles it with the generated `runTool`, which is what an application's queue or workflow does.
 *
 * Every scenario the suite has for the extension runs, but one: `tasks-status-notifications` grades
 * `notifications/tasks`, which is optional and not served here (tasks are polled), and against such
 * a server it runs no check at all. A scenario that grades nothing would pass here and prove
 * nothing, so each one below must grade at least one check. The scenarios this emitter does not
 * pass are listed with their reason in `tasks-extension.expected-failures.yml`, which the suite
 * reads, so a scenario that starts passing or a new failure both turn this red.
 */

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const here = join(packageRoot, "test", "conformance");
const run = promisify(execFile);

/**
 * **The official suite, fetched when this runs rather than installed beside the package.** It is
 * built on the v1 SDK, and this package is built on v2 alone, down to its lockfile: the suite is
 * an oracle to grade against, not something the emitter depends on. Pinned exactly, so a new
 * release of the suite is a deliberate change here.
 */
const ORACLE = "0.2.0-alpha.12";

const SCENARIOS = [
	"tasks-lifecycle",
	"tasks-capability-negotiation",
	"tasks-wire-fields",
	"tasks-request-state-removal",
	"tasks-mrtr-input",
	"tasks-request-headers",
	"tasks-dispatch-and-envelope",
	"tasks-required-task-error",
	"tasks-mrtr-composition",
] as const;

interface Call {
	readonly operationId: string;
	readonly input: Record<string, unknown>;
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
	readonly TasksExtension: new (
		store: TaskStore,
		options?: { defaultPollIntervalMs?: number },
	) => {
		create(
			context: unknown,
			options?: { context?: Record<string, unknown> },
		): Promise<TaskToolResult>;
		attach(server: McpServer): void;
	};
}

const handlers = {
	greet: (_caller: unknown, input: { name: string }) => ({
		status: 200,
		contentType: "text/plain",
		body: `Hello, ${input.name}!`,
	}),
	slow_compute: (_caller: unknown, input: { seconds: number; label?: string }) => ({
		status: 200,
		body: { label: input.label ?? "", seconds: input.seconds },
	}),
	failing_job: () => ({ status: 500, body: { message: "The job failed." } }),
	protocol_error_job: () => {
		throw new Error("The job's runner failed.");
	},
	confirm_delete: (_caller: unknown, input: { filename: string }) => ({
		status: 200,
		body: { deleted: input.filename },
	}),
	multi_input: () => ({ status: 200, body: { answered: 2 } }),
};

/** What a task waits for before its work can finish, by operation: the store asks, not the tool. */
const QUESTIONS: Readonly<Record<string, readonly string[]>> = {
	confirm_delete: ["confirm"],
	multi_input: ["first", "second"],
};

const ask = (key: string) => ({
	method: "elicitation/create",
	params: {
		mode: "form",
		message: `Please answer: ${key}?`,
		requestedSchema: { type: "object", properties: { confirm: { type: "boolean" } } },
	},
});

/**
 * Tasks whose work runs on a timer in this process: the stand-in for a queue or a workflow.
 *
 * - Work that fails BELOW the tool, as `protocol_error_job`'s does, settles `failed` with a protocol
 *   error; everything else settles with `runTool`'s answer.
 * - Work that needs answers first waits in `input_required` until `tasks/update` has delivered all
 *   of them, ignoring keys it did not ask. Asking is the store's: the tool's own result is unchanged.
 */
interface Entry {
	task: DetailedTask;
	readonly principal: string | undefined;
	readonly call: Call;
	timer?: ReturnType<typeof setTimeout>;
}

class TimedStore implements TaskStore {
	readonly #tasks = new Map<string, Entry>();

	constructor(readonly generated: Generated) {}

	async create(params: CreateTaskParams) {
		const now = new Date().toISOString();
		const task = {
			taskId: crypto.randomUUID(),
			status: "working" as const,
			createdAt: now,
			lastUpdatedAt: now,
			ttlMs: params.ttlMs,
			...(params.pollIntervalMs === undefined ? {} : { pollIntervalMs: params.pollIntervalMs }),
		};
		const call = params.context as unknown as Call;
		const entry: Entry = { task, principal: params.principal, call };
		this.#tasks.set(task.taskId, entry);
		const questions = QUESTIONS[call.operationId];
		if (questions === undefined) {
			this.#start(entry);
		} else {
			entry.task = {
				...task,
				status: "input_required",
				inputRequests: Object.fromEntries(questions.map((key) => [key, ask(key)])),
			};
		}
		return task;
	}

	#start(entry: Entry) {
		const seconds =
			typeof entry.call.input["seconds"] === "number" ? entry.call.input["seconds"] : 1;
		entry.timer = setTimeout(async () => {
			const settled =
				entry.call.operationId === "protocol_error_job"
					? {
							status: "failed" as const,
							error: { code: -32603, message: "The job's runner failed." },
						}
					: {
							status: "completed" as const,
							result: await this.generated.runTool(handlers, entry.call, null),
						};
			if (entry.task.status === "working") {
				entry.task = { ...entry.task, ...settled, lastUpdatedAt: new Date().toISOString() };
			}
		}, seconds * 1000);
	}

	#find(taskId: string, access?: TaskAccess) {
		const entry = this.#tasks.get(taskId);
		return entry === undefined || entry.principal !== access?.principal ? undefined : entry;
	}

	async get(taskId: string, access?: TaskAccess) {
		return this.#find(taskId, access)?.task;
	}

	async update(
		taskId: string,
		inputResponses: Readonly<Record<string, unknown>>,
		access?: TaskAccess,
	) {
		const entry = this.#find(taskId, access);
		if (entry === undefined) return false;
		if (entry.task.status !== "input_required") return true;
		const remaining = Object.fromEntries(
			Object.entries(entry.task.inputRequests).filter(([key]) => !(key in inputResponses)),
		);
		const { inputRequests: _asked, ...task } = entry.task;
		entry.task =
			Object.keys(remaining).length > 0
				? { ...entry.task, inputRequests: remaining, lastUpdatedAt: new Date().toISOString() }
				: { ...task, status: "working", lastUpdatedAt: new Date().toISOString() };
		if (entry.task.status === "working") this.#start(entry);
		return true;
	}

	async cancel(taskId: string, access?: TaskAccess) {
		const entry = this.#find(taskId, access);
		if (entry === undefined) return false;
		if (entry.task.status === "working" || entry.task.status === "input_required") {
			clearTimeout(entry.timer);
			const { inputRequests: _asked, ...task } = entry.task as DetailedTask & {
				inputRequests?: unknown;
			};
			entry.task = { ...task, status: "cancelled", lastUpdatedAt: new Date().toISOString() };
		}
		return true;
	}
}

let server: Server;
let url: string;

beforeAll(async () => {
	const compiled = await compileFixture(here, "tasks-extension", { outName: "tasks-extension" });
	expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	const generated = (await import(join(compiled.outDir, "mcp.gen.ts"))) as unknown as Generated;
	const runtime = (await import(
		join(compiled.outDir, "mcp-runtime.gen.ts")
	)) as unknown as EmittedRuntime;

	const tasks = new runtime.TasksExtension(new TimedStore(generated), {
		defaultPollIntervalMs: 100,
	});
	const handler = createMcpHandler(() => {
		const mcp = new McpServer({ name: "tasks-conformance", version: "1.0.0" });
		tasks.attach(mcp);
		generated.registerTools(mcp, () => handlers, {
			permits: () => true,
			context: () => ({}),
			noContext: () => ({ content: [], isError: true }),
			tasks: {
				operations: [
					"slow_compute",
					"failing_job",
					"protocol_error_job",
					"confirm_delete",
					"multi_input",
				],
				// The immediate path: work with nothing to wait for is answered at once.
				decide: (call: Call) => (call.input["seconds"] === 0 ? "inline" : "task"),
				create: (call: Call, _caller: unknown, context: unknown) =>
					tasks.create(context, { context: { ...call } }),
			},
		});
		return mcp;
	});

	server = createServer(async (request, response) => {
		const body = await new Promise<Buffer>((resolve) => {
			const chunks: Buffer[] = [];
			request.on("data", (chunk: Buffer) => chunks.push(chunk));
			request.on("end", () => resolve(Buffer.concat(chunks)));
		});
		const headers = new Headers();
		for (const [name, value] of Object.entries(request.headers)) {
			if (typeof value === "string") headers.set(name, value);
			else if (Array.isArray(value)) for (const each of value) headers.append(name, each);
		}
		const answer = await handler.fetch(
			new Request(`http://${request.headers.host ?? "localhost"}${request.url ?? "/"}`, {
				method: request.method ?? "GET",
				headers,
				...(body.length > 0 ? { body } : {}),
			}),
		);
		response.writeHead(answer.status, Object.fromEntries(answer.headers));
		if (answer.body === null) response.end();
		else Readable.fromWeb(answer.body as never).pipe(response);
	});
	await new Promise<void>((resolve) => server.listen(0, "localhost", resolve));
	url = `http://localhost:${(server.address() as AddressInfo).port}/mcp`;
}, 300_000);

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("the official Tasks conformance scenarios", () => {
	for (const scenario of SCENARIOS) {
		it(
			scenario,
			async () => {
				const results = join(here, ".out", "tasks-extension-results", scenario);
				rmSync(results, { recursive: true, force: true });
				mkdirSync(results, { recursive: true });
				const { stdout, stderr, code } = await run(
					"pnpm",
					[
						"dlx",
						`--package=@modelcontextprotocol/conformance@${ORACLE}`,
						"conformance",
						"server",
						"--url",
						url,
						"--scenario",
						scenario,
						"--expected-failures",
						join(here, "tasks-extension.expected-failures.yml"),
					],
					{ cwd: results, timeout: 240_000 },
				).then(
					(done) => ({ ...done, code: 0 }),
					(failed: { stdout: string; stderr: string; code: number }) => failed,
				);
				// A scenario whose checks all skip passes with nothing graded, so each must grade something.
				const ran = /Passed: (\d+)\/(\d+)/.exec(stdout);
				expect({ scenario, checks: Number(ran?.[2] ?? 0) > 0 }).toEqual({ scenario, checks: true });
				expect({ scenario, code, output: code === 0 ? "" : `${stdout}\n${stderr}` }).toEqual({
					scenario,
					code: 0,
					output: "",
				});
			},
			300_000,
		);
	}
});
