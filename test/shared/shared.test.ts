import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, NodeHost, type Diagnostic } from "@typespec/compiler";
import { describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **Each operation on a shared route is a tool of its own: its own description, its own tags, and
 * its own diagnostics.** See `shared.tsp`.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

/** The description a registration publishes for one tool, read off the emitted call. */
function descriptionOf(source: string, tool: string): string | undefined {
	const call = new RegExp(
		`registerTool\\(\\s*"${tool}",\\s*\\{\\s*(?:title: [^\\n]*\\s*)?description: ("[^"\\n]*")`,
	);
	const match = call.exec(source)?.[1];
	return match === undefined ? undefined : (JSON.parse(match) as string);
}

describe("an operation on a shared route is described, selected and diagnosed as itself", () => {
	it("publishes each member's own doc comment as its tool's description", async () => {
		const { outDir, diagnostics } = await compileFixture(here, "shared");
		expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		const source = readFileSync(join(outDir, "mcp.gen.ts"), "utf8");
		expect(descriptionOf(source, "reportAsText")).toBe("The report, as plain text.");
		expect(descriptionOf(source, "reportAsJson")).toBe("The report, as JSON.");
	}, 300_000);

	it("selects a member by its own tags, not its neighbour's", async () => {
		const { outDir } = await compileFixture(here, "shared", {
			outName: "shared-tagged",
			extraOptions: { "tool-tags": ["agent"] },
		});
		const source = readFileSync(join(outDir, "mcp.gen.ts"), "utf8");
		expect(/TOOL_NAMES = (\[[^\]]*\])/.exec(source)?.[1]).toBe('["reportAsText"]');
	}, 300_000);

	it("raises a member's diagnostic against that member", async () => {
		// Emitted, not `noEmit`: the diagnostic is raised by the emitter, which `noEmit` never runs.
		const outDir = join(here, ".out", "shared-diagnostics");
		const program = await compile(NodeHost, join(here, "shared.tsp"), {
			outputDir: outDir,
			emit: ["typespec-http-mcp"],
			options: { "typespec-http-mcp": { "emitter-output-dir": outDir } },
		});
		const named = (diagnostic: Diagnostic): string | undefined => {
			const target = diagnostic.target;
			return typeof target === "object" && "kind" in target && target.kind === "Operation"
				? target.name
				: undefined;
		};
		const undescribed = program.diagnostics
			.filter((diagnostic) => diagnostic.code === "typespec-http-mcp/tool-without-description")
			.map((diagnostic) => [/'([^']+)'/.exec(diagnostic.message)?.[1], named(diagnostic)]);
		expect(undescribed.toSorted()).toEqual([
			["statusAsJson", "statusAsJson"],
			["statusAsText", "statusAsText"],
		]);
	}, 300_000);
});
