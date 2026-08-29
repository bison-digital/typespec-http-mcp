import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **What this emitter writes, graded against what the LIBRARY suggests.**
 *
 * The MCP SDK carries its own canonical examples inside its published type declarations, anchored as
 * `source="./mcp.examples.ts#..."`. Those are the shape the library recommends, written by its
 * authors, shipped with the version installed here -- so they move when the SDK moves, and this arm
 * moves with them. An expectation typed into this file would be a second opinion about the SDK's own
 * recommendation, which is exactly what a golden standard must not be.
 */

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const reference = join(packageRoot, "test", "reference");

/** Every fenced example the SDK anchors in its own declarations, keyed by anchor name. */
function sdkExamples(): Map<string, string> {
	const dist = join(packageRoot, "node_modules", "@modelcontextprotocol", "server", "dist");
	// Every declaration file: the tool examples sit in the createMcpHandler chunk and the auth ones
	// in index.d.mts, so reading only the first would silently lose half the golden standard.
	const text = readdirSync(dist)
		.filter((name) => name.endsWith(".d.mts"))
		.map((name) => readFileSync(join(dist, name), "utf8"))
		.join("\n");
	const examples = new Map<string, string>();
	for (const match of text.matchAll(
		/source="\.\/[a-zA-Z]+\.examples\.ts#(\w+)"\n([\s\S]*?)\n\s*\*\s*```/g,
	)) {
		const body = (match[2] ?? "")
			.split("\n")
			.map((line) => line.replace(/^\s*\*\s?/, ""))
			.join("\n")
			.trim();
		examples.set(match[1] ?? "", body);
	}
	return examples;
}

let emitted = "";
let golden = new Map<string, string>();

beforeAll(async () => {
	const { outDir } = await compileFixture(reference, "service", { bare: true, outName: "golden" });
	emitted = readFileSync(join(outDir, "mcp.gen.ts"), "utf8");
	golden = sdkExamples();
}, 300_000);

describe("the SDK's own examples are readable, so this arm can grade against them", () => {
	it("found the canonical registerTool example", () => {
		expect(golden.has("McpServer_registerTool_basic")).toBe(true);
		expect(golden.get("McpServer_registerTool_basic")).toContain("server.registerTool(");
	});

	it("found enough examples that the extraction is not matching one thing by luck", () => {
		expect(golden.size).toBeGreaterThanOrEqual(4);
	});
});

describe("the emitted call site has the shape the SDK recommends", () => {
	/** Every key the SDK's own example passes in the config object. */
	function configKeysOf(source: string): string[] {
		return ["title", "description", "inputSchema", "outputSchema"].filter((key) =>
			new RegExp(`\\b${key}:`).test(source),
		);
	}

	it("uses the three-argument form: name, config object, callback", () => {
		const example = golden.get("McpServer_registerTool_basic") ?? "";
		expect(example).toMatch(/registerTool\(\s*\n?\s*'[^']+',/);
		expect(emitted).toMatch(/registerTool\(\s*\n?\s*"[^"]+",/);
	});

	it("passes every config key the SDK's example passes", () => {
		const wanted = configKeysOf(golden.get("McpServer_registerTool_basic") ?? "");
		expect(wanted).toEqual(["title", "description", "inputSchema", "outputSchema"]);
		const missing = wanted.filter((key) => !new RegExp(`\\b${key}:`).test(emitted));
		expect(missing).toEqual([]);
	});

	/**
	 * **The SDK's example passes a SCHEMA, not a raw shape**, and the difference is not cosmetic: the
	 * raw-shape overload is marked `@deprecated` and routes to a different callback type. Measured
	 * against `zod@4.5`, it does not even compile -- `ZodString` is not assignable to the `ZodType`
	 * the legacy signature expects, because the two disagree about `_zod.version.minor`.
	 */
	it("passes inputSchema as a schema value, as the SDK's example does", () => {
		expect(golden.get("McpServer_registerTool_basic")).toMatch(/inputSchema: z\.object\(/);
		const inputs = [...emitted.matchAll(/inputSchema: (\w+)/g)].map((m) => m[1] ?? "");
		expect(inputs.length).toBeGreaterThanOrEqual(5);
		// Each names a const declared as a Zod object, never an inline `{ field: z.string() }`.
		for (const name of new Set(inputs)) {
			expect(emitted, name).toMatch(new RegExp(`const ${name} = z\\.(loose|strict)Object\\(`));
		}
		expect(emitted).not.toMatch(/inputSchema: \{/);
	});

	it("returns content AND structuredContent, as the SDK's example does", () => {
		const example = golden.get("McpServer_registerTool_basic") ?? "";
		expect(example).toContain("content: [{ type: 'text'");
		expect(example).toContain("structuredContent");
		/**
		 * The emitted callback delegates to `deps.respond`, because the result envelope is the
		 * application's. What produces the SDK's shape is `toolResult` in the runtime, which
		 * `test/runtime/result.test.ts` grades against the SDK's own result schema.
		 */
		const runtime = readFileSync(join(packageRoot, "src", "runtime.ts"), "utf8");
		expect(runtime).toContain(
			'content: hasBody ? [{ type: "text", text: JSON.stringify(body) }] : []',
		);
		expect(runtime).toContain("result.structuredContent = body");
	});

	it("constructs the server the way the SDK's example does, in the docs a consumer copies", () => {
		const basic = golden.get("McpServer_basicUsage") ?? "";
		expect(basic).toMatch(/new McpServer\(\{[\s\S]*name:[\s\S]*version:/);
		const guides = readFileSync(join(packageRoot, "docs", "guides.md"), "utf8");
		expect(guides).toMatch(/new McpServer\(\{ name: "[^"]+", version: "[^"]+" \}\)/);
	});
});

/**
 * **The wiring a consumer copies, pinned to the SDK's own example.**
 *
 * The README once showed `createMcpHandler(factory)(request, env, ctx)` -- the shape of Cloudflare's
 * `agents` wrapper, not of the SDK this package targets, which returns an object with a `fetch`
 * method. A consumer copying it got `TypeError: handler is not a function`, and every arm here was
 * green because they grade `registerTool` and not the handler.
 */
describe("the documented wiring matches the SDK, not a wrapper around it", () => {
	const readme = readFileSync(join(packageRoot, "README.md"), "utf8");
	const guides = readFileSync(join(packageRoot, "docs", "guides.md"), "utf8");

	it("serves through handler.fetch, never by calling the handler", () => {
		for (const [name, doc] of [
			["README", readme],
			["guides", guides],
		] as const) {
			expect(doc, name).toContain("handler.fetch(request)");
			expect(doc, name).not.toMatch(/createMcpHandler\([^)]*\)\(request/);
		}
	});

	/**
	 * The SDK anchors this example as `requireBearerAuth_fetchGate`. If its recommended gate changes
	 * shape, this fails rather than leaving the guide quietly wrong.
	 */
	it("gates auth the way the SDK's own example does", () => {
		const example = golden.get("requireBearerAuth_fetchGate") ?? "";
		expect(example, "the SDK still ships this example").toContain("requireBearerAuth(");
		for (const step of [
			"requireBearerAuth(",
			"instanceof Response",
			"handler.fetch(request, { authInfo:",
		]) {
			expect(example, `SDK example: ${step}`).toContain(step);
			expect(guides, `guides: ${step}`).toContain(step);
		}
	});

	it("builds discovery from the SDK's helpers rather than by hand", () => {
		for (const helper of ["oauthMetadataResponse", "getOAuthProtectedResourceMetadataUrl"]) {
			expect(guides, helper).toContain(helper);
		}
		/**
		 * And nothing in this package reimplements any of it.
		 *
		 * **Comments are stripped first.** A docblock that NAMES the challenge in order to say the SDK
		 * owns it is the documentation working; the first version of this arm forbade the string and
		 * fired on exactly that sentence. What must be absent is code.
		 */
		const src = readdirSync(join(packageRoot, "src"))
			.filter((name) => name.endsWith(".ts"))
			.map((name) => readFileSync(join(packageRoot, "src", name), "utf8"))
			.join("\n")
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/\/\/[^\n]*/g, "");
		for (const forbidden of ["WWW-Authenticate", "oauth-protected-resource", "verifyAccessToken"]) {
			expect(src, `src reimplements ${forbidden}`).not.toContain(forbidden);
		}
	});

	it("emits the one authentication fact the SDK cannot know", () => {
		expect(emitted).toContain("export const SCOPES_SUPPORTED");
		expect(guides).toContain("scopesSupported: [...SCOPES_SUPPORTED]");
	});
});

/**
 * **The wiring must be able to do what `permits` promises.**
 *
 * `permits` is consulted when the server is built, so the grant has to reach the factory. Both docs
 * once showed `deps` at module scope behind a zero-argument factory: every caller then saw an
 * identical tool list, and the per-caller filtering this emitter is built around was inert. The
 * guide even said "build one per request" in prose directly below an example that could not.
 */
describe("the documented wiring can actually filter per caller", () => {
	const docs = [
		["README", readFileSync(join(packageRoot, "README.md"), "utf8")],
		["guides", readFileSync(join(packageRoot, "docs", "guides.md"), "utf8")],
	] as const;

	it("passes the request context into the server factory", () => {
		for (const [name, doc] of docs) {
			expect(doc, `${name}: factory takes the context`).toMatch(
				/createMcpHandler\(\(\s*context\s*[),]/,
			);
			// The shape that cannot see a caller.
			expect(doc, `${name}: zero-argument factory`).not.toMatch(/createMcpHandler\(\(\)\s*=>/);
		}
	});

	it("builds deps inside the factory, never once at module scope", () => {
		for (const [name, doc] of docs) {
			const factoryAt = doc.indexOf("createMcpHandler((context");
			const depsAt = doc.indexOf("const deps: ToolDeps");
			expect(depsAt, `${name}: deps is declared`).toBeGreaterThan(-1);
			expect(depsAt, `${name}: deps built inside the factory`).toBeGreaterThan(factoryAt);
		}
	});
});
