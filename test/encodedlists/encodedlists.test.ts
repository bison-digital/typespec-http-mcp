import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";
import { clientFor, type Client, type Generated } from "../support/mcp-client.js";

/**
 * **An `@encode`d list parameter is a tool argument of the type the document publishes for it.** See
 * `encodedlists.tsp`.
 *
 * `EmittedRoute.decodedPathParameters` chooses a path argument's value schema, and the library shaped
 * `@path @encode(ArrayEncoding.commaDelimited) ids: string[]` as a list to split, though the document
 * publishes it as `type: string` and its validator is `z.string()`. It is shaped from the encoded type
 * now, so the tool takes the string, as `tools/list` says, and hands it to the handler unchanged.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let client: Client;

beforeAll(async () => {
	const { outDir, diagnostics } = await compileFixture(here, "encodedlists", {
		outName: "encodedlists",
	});
	// The fixture documents no operation, so each tool carries that quality warning and nothing else.
	expect(
		diagnostics.filter((d) => d.code !== "typespec-http-mcp/tool-without-description"),
	).toEqual([]);
	const generated = (await import(join(outDir, "mcp.gen.ts"))) as unknown as Generated;
	client = clientFor(generated, { status: 200, body: { id: "t" } });
}, 300_000);

const argumentSchema = async (tool: string, name: string) => {
	const listed = (await client.rpc("tools/list")) as {
		tools: { name: string; inputSchema: { properties: Record<string, unknown> } }[];
	};
	return listed.tools.find((candidate) => candidate.name === tool)?.inputSchema.properties[name];
};

describe("each encoded list, as a tool argument", () => {
	it("P: publishes the path list as the string the document states", async () => {
		expect(await argumentSchema("P_read", "ids")).toMatchObject({ type: "string" });
	});

	it("H: publishes the header list as the string the document states", async () => {
		expect(await argumentSchema("H_read", "x-tags")).toMatchObject({ type: "string" });
	});

	/** tool, its arguments, what the handler receives. */
	const CASES: readonly (readonly [string, Record<string, unknown>, unknown])[] = [
		["P_read", { ids: "a,b" }, { ids: "a,b" }],
		["H_read", { "x-tags": "a,b" }, { "x-tags": "a,b" }],
		["C_read", { tags: "a,b" }, { tags: "a,b" }],
		["Q_read", { ids: [1, 2] }, { ids: [1, 2] }],
		["S_read", { tags: ["a", "b"] }, { tags: ["a", "b"] }],
	];

	for (const [tool, args, expected] of CASES) {
		it(`${tool}: hands the handler ${JSON.stringify(expected)}`, async () => {
			const result = (await client.rpc("tools/call", { name: tool, arguments: args })) as {
				isError?: boolean;
			};
			expect(result.isError).toBeUndefined();
			expect(client.received.get(tool)).toEqual(expected);
		});
	}
});
