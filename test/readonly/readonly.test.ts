import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";
import { clientFor, type Generated } from "../support/mcp-client.js";

/**
 * **A tool taking a create body may be called without its server-assigned read-only `id` where
 * openapi3 publishes OpenAPI 3.0, its default** - OAS 3.0.4 requires such a property "on the response
 * only" - and its published `inputSchema` says so. On `typespec-http-zod` 0.31.0 the tool required
 * the `id` at every version. At 3.1, where `readOnly` is an annotation, it is required, and the
 * `inputSchema` says that too. Over the wire: `tools/list`, then `tools/call`.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

async function clientAt(versions?: readonly string[]) {
	const compiled = await compileFixture(here, "readonly", {
		outName: `readonly-${versions?.join("_") ?? "default"}`,
		...(versions === undefined ? {} : { openapiVersions: versions }),
	});
	expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	const generated = (await import(join(compiled.outDir, "mcp.gen.ts"))) as unknown as Generated;
	return clientFor(generated, { status: 201, body: { id: "w1", name: "a", items: [] } });
}

const required = async (client: Awaited<ReturnType<typeof clientAt>>): Promise<unknown> => {
	const listed = (await client.rpc("tools/list")) as {
		tools: { name: string; inputSchema: { required?: string[] } }[];
	};
	return listed.tools.find((tool) => tool.name === "create")?.inputSchema.required;
};

const call = async (client: Awaited<ReturnType<typeof clientAt>>, args: object) =>
	((await client.rpc("tools/call", { name: "create", arguments: args })) as { isError?: boolean })
		.isError === true;

describe("a create tool and its server-assigned read-only id", () => {
	it("is called without the id where openapi3 publishes 3.0, its default", async () => {
		const client = await clientAt();
		expect(await required(client)).toEqual(["name", "items"]);
		expect(await call(client, { name: "a", items: [{ label: "x" }] })).toBe(false);
		expect(client.received.get("create")).toEqual({ name: "a", items: [{ label: "x" }] });
	});

	it("needs the id where openapi3 publishes 3.1", async () => {
		const client = await clientAt(["3.1.0"]);
		expect(await required(client)).toEqual(["id", "name", "items"]);
		expect(await call(client, { name: "a", items: [{ label: "x" }] })).toBe(true);
		expect(await call(client, { id: "c", name: "a", items: [{ id: "c", label: "x" }] })).toBe(
			false,
		);
	});
});
