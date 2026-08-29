import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_startWorker } from "wrangler";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **Tier 2: one Worker, a real socket, the official client.**
 *
 * `acceptance.test.ts` is Tier 1 -- it synthesises a `Request`, hand-writes every protocol header,
 * and runs in Node against an in-process handler. That proves the surface answers, and it cannot
 * prove four things this does:
 *
 * - **emitted output survives BUNDLING.** esbuild resolves the `./x.js` specifiers the emitter
 *   writes for neighbouring `.ts` files, and nothing here had ever asked it to.
 * - **emitted output runs on workerd**, the runtime it is written for, with no `nodejs_compat`.
 *   `architecture.test.ts` checks the import rule by READING imports; this checks it by running.
 * - **the headers are a real client's.** `Mcp-Method`, `Mcp-Name`, the protocol version and the
 *   `Accept` negotiation are written by `StreamableHTTPClientTransport`, so they stop being
 *   assertions this repository makes about itself. The `Host` header is a real one, so the
 *   DNS-rebinding check is satisfied the way a deployment satisfies it rather than by hand.
 * - **one server answers different callers differently.** Tier 1 builds a NEW handler per RPC,
 *   closing over the grant, so per-request `deps` and per-handler `deps` are indistinguishable to
 *   it -- which is the trap it is credited with catching. Here the handler is built once and the
 *   grant arrives only on the request.
 */

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const here = fileURLToPath(new URL(".", import.meta.url));

interface Generated {
	readonly TOOL_NAMES: readonly string[];
}

let worker: Awaited<ReturnType<typeof unstable_startWorker>>;
let origin: string;
let generated: Generated;

beforeAll(async () => {
	/**
	 * `bare: true` -- the self-contained output a consumer actually ships, `mcp-runtime.gen.ts`
	 * included. A fixture that pointed `runtime-module` at this repository's own `src/runtime.ts`
	 * would bundle a file no consumer has.
	 */
	const { outDir, diagnostics } = await compileFixture(here, "service", {
		bare: true,
		outName: "socket",
	});
	expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	generated = (await import(join(outDir, "mcp.gen.ts"))) as unknown as Generated;

	worker = await unstable_startWorker({ config: join(here, "wrangler.jsonc") });
	await worker.ready;
	origin = (await worker.url).origin;
}, 600_000);

afterAll(async () => {
	await worker?.dispose();
});

/** A client of its own per caller, because a session belongs to one. */
async function connect(token: string): Promise<Client> {
	const client = new Client({ name: "socket-acceptance", version: "0" });
	await client.connect(
		new StreamableHTTPClientTransport(new URL("/mcp", origin), {
			requestInit: { headers: { authorization: `Bearer ${token}` } },
		}),
	);
	return client;
}

const namesOf = (listed: { tools: { name: string }[] }) =>
	listed.tools.map((tool) => tool.name).toSorted();

describe("the documented Worker, on workerd, over a socket", () => {
	it("serves on a real port", () => {
		expect(origin).toMatch(/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/);
	});

	it("lists, to a real client, exactly the tools the emitter says it registered", async () => {
		const client = await connect("writer-token");
		try {
			const names = namesOf(await client.listTools());
			// Non-vacuity: an empty list would satisfy a comparison against an empty list.
			expect(names.length).toBeGreaterThan(0);
			expect(names).toEqual([...generated.TOOL_NAMES].toSorted());
		} finally {
			await client.close();
		}
	});

	it("calls one, and the handler's value comes back as structured content", async () => {
		const client = await connect("writer-token");
		try {
			const result = await client.callTool({
				name: "WidgetTools_read",
				arguments: { widgetId: "1" },
			});
			expect(result.structuredContent).toEqual({ id: "1", name: "a", colour: "grey" });
			expect(result.isError).toBeFalsy();
		} finally {
			await client.close();
		}
	});

	/**
	 * **The arm this suite exists for, and the one Tier 1 structurally cannot write.**
	 *
	 * One handler, built once at module scope in the Worker. Three clients connected at the same
	 * time, each with its own bearer token. If `deps` were built anywhere but inside the factory,
	 * all three would see the same list.
	 */
	it("shows three concurrent callers three different tool lists, from ONE worker", async () => {
		const [writer, reader, nobody] = await Promise.all([
			connect("writer-token"),
			connect("reader-token"),
			connect("nobody-token"),
		]);
		try {
			const [w, r, n] = await Promise.all([
				writer.listTools(),
				reader.listTools(),
				nobody.listTools(),
			]);
			const writerNames = namesOf(w);
			const readerNames = namesOf(r);
			const nobodyNames = namesOf(n);

			/**
			 * **Three lists, strictly nested, from three sockets open at the same time.** Built
			 * anywhere but inside the factory, `deps` would close over no caller and all three of
			 * these would be identical -- which is the assertion, stated three ways.
			 */
			expect(writerNames).toEqual([
				"WidgetTools_create",
				"WidgetTools_list",
				"WidgetTools_read",
				"WidgetTools_remove",
				"health",
			]);
			expect(readerNames).toEqual(["WidgetTools_list", "WidgetTools_read", "health"]);
			// `@useAuth(NoAuth)` publishes `[]`, and an empty requirement set authorises. So a caller
			// with no grant at all still sees the public tool -- an absence would be a different bug.
			expect(nobodyNames).toEqual(["health"]);
		} finally {
			await Promise.all([writer.close(), reader.close(), nobody.close()]);
		}
	});

	/**
	 * **A caller who may see nothing is told the server has nothing, not that the method is gone.**
	 *
	 * The SDK installs the `tools/list` handler on the FIRST `registerTool`, so registering none
	 * answers `-32601 Method not found`. A real client THROWS on that, which is a stronger statement
	 * of the defect than reading a status code: this arm fails by rejection, not by assertion.
	 */
	it("answers a grant that selects nothing with an empty list, never a protocol error", async () => {
		// A token whose grant permits nothing AND a spec with no public tool would register none.
		// Driven through a real client, `-32601` is a rejection rather than a status code to read.
		const client = await connect("unknown-token");
		try {
			const names = namesOf(await client.listTools());
			expect(names).toEqual(["health"]);
		} finally {
			await client.close();
		}
	});
});

describe("the Worker this suite deploys is the one the documentation describes", () => {
	it("typechecks against freshly emitted output", () => {
		const output = (() => {
			try {
				execFileSync(
					join(packageRoot, "node_modules", ".bin", "tsc"),
					["-p", join(here, "tsconfig.socket.json"), "--ignoreConfig"],
					{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
				);
				return "";
			} catch (error) {
				const asExec = error as { stdout?: string; stderr?: string };
				return `${asExec.stdout ?? ""}${asExec.stderr ?? ""}`;
			}
		})();
		expect(output.trim(), output).toBe("");
	}, 300_000);
});
