import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **Two services in one program, which the conformance corpus cannot exercise.**
 *
 * `@typespec/http-specs` declares no scenario with more than one `@service`, so every arm in this
 * package -- all 65 corpus scenarios and every hand-written fixture -- has only ever seen a
 * single-service program. The one shape nobody had compiled is the one where the emitter's
 * per-service loop can collide with itself.
 *
 * **The specific hazard, and it is recorded in the emitter's own docblock.** `src/emitter.ts` writes
 * `resolvePath(emitted.outputDir, "mcp.gen.ts")` once per service, and `emitFile` has no
 * duplicate-path detection -- measured against `@typespec/compiler` 1.15.0. Two services resolving
 * to one directory is a silent last-writer-wins: exit 0, no diagnostic, and one service's entire
 * tool surface gone. The sibling library has already paid for exactly this once.
 *
 * Measured here: it does not happen. Each service gets a directory named after it. These arms are
 * what stop that becoming untrue.
 */

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const here = fileURLToPath(new URL(".", import.meta.url));

let outDir: string;

beforeAll(async () => {
	const compiled = await compileFixture(here, "services", {
		outName: "multiservice",
	});
	expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	outDir = compiled.outDir;
}, 300_000);

const read = (service: string, file: string) => readFileSync(join(outDir, service, file), "utf8");

const toolNamesOf = (service: string): string[] => {
	const match = /TOOL_NAMES = \[([^\]]*)\]/.exec(read(service, "mcp.gen.ts"));
	return [...(match?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "").toSorted();
};

describe("two services in one program each get a surface of their own", () => {
	it("writes one directory per service, named after the service", () => {
		const directories = readdirSync(outDir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.toSorted();
		expect(directories).toEqual(["Gadgets", "Widgets"]);
	});

	it("writes a complete set of files into each", () => {
		for (const service of ["Widgets", "Gadgets"]) {
			for (const file of ["mcp.gen.ts", "mcp-runtime.gen.ts", "schemas.gen.ts"]) {
				expect(existsSync(join(outDir, service, file)), `${service}/${file}`).toBe(true);
			}
		}
	});

	/**
	 * **The arm the collision would break.** Last-writer-wins would leave one of these two holding
	 * the other's tools, or holding nothing.
	 */
	it("gives each service its own operations and none of the other's", () => {
		expect(toolNamesOf("Widgets")).toEqual(["listWidgets", "readWidget"]);
		expect(toolNamesOf("Gadgets")).toEqual(["listGadgets"]);
	});

	it("gives each service its own validators and none of the other's", () => {
		expect(read("Widgets", "schemas.gen.ts")).toContain("widgetSchema");
		expect(read("Widgets", "schemas.gen.ts")).not.toContain("gadgetSchema");
		expect(read("Gadgets", "schemas.gen.ts")).toContain("gadgetSchema");
		expect(read("Gadgets", "schemas.gen.ts")).not.toContain("widgetSchema");
	});

	/**
	 * The runtime is copied per service, so each output directory is independently self-contained --
	 * a consumer may ship one service and not the other.
	 */
	it("copies the runtime into each, so either directory can be shipped alone", () => {
		const source = readFileSync(join(packageRoot, "src", "runtime.ts"), "utf8");
		for (const service of ["Widgets", "Gadgets"]) {
			// The banner is prepended, so the copy ENDS with the source rather than equalling it.
			expect(read(service, "mcp-runtime.gen.ts").endsWith(source), service).toBe(true);
		}
	});

	it("emits output that compiles, for both", () => {
		for (const service of ["Widgets", "Gadgets"]) {
			const dir = join(outDir, service);
			const config = join(dir, "tsconfig.emitted.json");
			writeFileSync(
				config,
				JSON.stringify({
					compilerOptions: {
						target: "es2023",
						module: "nodenext",
						moduleResolution: "nodenext",
						strict: true,
						exactOptionalPropertyTypes: true,
						noUncheckedIndexedAccess: true,
						noUnusedLocals: true,
						noUnusedParameters: true,
						noEmit: true,
						skipLibCheck: true,
						types: [],
					},
					include: ["./*.ts"],
				}),
			);
			let output = "";
			try {
				execFileSync(
					join(packageRoot, "node_modules", ".bin", "tsc"),
					["-p", config, "--ignoreConfig"],
					{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
				);
			} catch (error) {
				const asExec = error as { stdout?: string; stderr?: string };
				output = `${asExec.stdout ?? ""}${asExec.stderr ?? ""}`;
			}
			expect(output.trim(), `${service}: ${output}`).toBe("");
		}
	}, 300_000);
});
