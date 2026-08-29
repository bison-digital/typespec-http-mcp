import { rmSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, NodeHost } from "@typespec/compiler";

/**
 * Compile one spec through BOTH emitters, into ONE directory, with ONE runtime module.
 *
 * **One program, not two.** Two compiles would compare artefacts from two separately resolved
 * programs, and any disagreement would be ambiguous between "the emitters disagree" and "the
 * compiles differed". The estate's corpus harness holds the same rule for the same reason.
 *
 * Both emitters run `typespec-http-zod`, so both write `schemas.gen.ts`. With identical options that
 * is byte-identical content and harmless -- which is exactly the arrangement this arm needs, and the
 * one a consumer wanting both surfaces will have.
 */
export async function compileBothSurfaces(outName: string): Promise<{
	readonly outDir: string;
	readonly diagnostics: readonly { readonly code: string; readonly severity: string }[];
}> {
	const here = fileURLToPath(new URL(".", import.meta.url));
	const outDir = join(here, ".out", outName);
	rmSync(outDir, { recursive: true, force: true });

	const runtime = join(here, "runtime.ts");
	const specifier = relative(outDir, runtime).replaceAll("\\", "/").replace(/\.ts$/, ".js");
	const runtimeModule = specifier.startsWith(".") ? specifier : `./${specifier}`;

	const shared = {
		"emitter-output-dir": outDir,
		"runtime-module": runtimeModule,
	};

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
