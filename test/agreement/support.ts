import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, NodeHost } from "@typespec/compiler";

/**
 * Compile one spec through BOTH emitters, into ONE directory, each with the runtime it emits.
 *
 * **One program, not two.** Two compiles would compare artefacts from two separately resolved
 * programs, and any disagreement would be ambiguous between "the emitters disagree" and "the
 * compiles differed". The estate's corpus harness holds the same rule for the same reason.
 *
 * Both emitters run `typespec-http-zod`, so both write `schemas.gen.ts`. With identical options that
 * is byte-identical content and harmless -- which is exactly the arrangement this arm needs, and the
 * one a consumer wanting both surfaces will have.
 *
 * **No `runtime-module`, and no substituted runtime.** The shared file used to import its arm type
 * from a runtime both emitters had to be pointed at; it now declares that type itself, so the two
 * emitters' own runtimes (`runtime.gen.ts`, `mcp-runtime.gen.ts`) sit side by side and nothing is
 * contested but `schemas.gen.ts`.
 */
export async function compileBothSurfaces(outName: string): Promise<{
	readonly outDir: string;
	readonly diagnostics: readonly { readonly code: string; readonly severity: string }[];
}> {
	const here = fileURLToPath(new URL(".", import.meta.url));
	const outDir = join(here, ".out", outName);
	rmSync(outDir, { recursive: true, force: true });

	const shared = { "emitter-output-dir": outDir };

	const program = await compile(NodeHost, join(here, "service.tsp"), {
		outputDir: outDir,
		emit: ["typespec-hono", "typespec-http-mcp"],
		options: { "typespec-hono": shared, "typespec-http-mcp": shared },
	});

	return {
		outDir,
		diagnostics: program.diagnostics.map((d) => ({ code: d.code, severity: d.severity })),
	};
}
