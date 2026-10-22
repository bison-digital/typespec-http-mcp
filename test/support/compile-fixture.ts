import { rmSync } from "node:fs";
import { join } from "node:path";
import { compile, NodeHost } from "@typespec/compiler";

/**
 * Compile one `.tsp` fixture with this emitter, and hand back where it landed.
 *
 * **Shared rather than copied into each suite.** A second copy of a harness is how two artefacts in
 * the sibling packages came to quote one rule differently, and how three oracles there came to grade
 * whatever the previous run had left on disk.
 *
 * **One emitter, every file.** This package runs the whole of `typespec-http-zod` and adds its own
 * output beside it, so a fixture lists `typespec-http-mcp` alone and gets the validators too. That
 * is the arrangement a consumer has, and compiling it any other way would test something nobody
 * ships.
 */
export interface CompiledFixture {
	readonly outDir: string;
	/** Where `@typespec/openapi3` wrote, when `withDocument` was set. */
	readonly documentDir: string;
	readonly diagnostics: readonly { readonly code: string; readonly severity: string }[];
	/**
	 * The same diagnostics with the message the compiler formatted, for an arm that has to know which
	 * operation one was raised against. Kept apart so the arms comparing `{ code, severity }` exactly
	 * are not rewritten around a field they do not grade.
	 */
	readonly messages: readonly { readonly code: string; readonly message: string }[];
}

export interface FixtureOptions {
	/**
	 * The output directory's name, when it must differ from the spec's.
	 *
	 * **Two suites compiling one fixture to one directory with DIFFERENT options overwrite each
	 * other, and vitest runs test files in parallel.** A suite that races itself is not evidence, and
	 * the failure looks exactly like a flaky emitter. `isolation.test.ts` asserts no two share one.
	 */
	readonly outName?: string;
	/** The full output directory, when a suite owns one of its own rather than sharing `dir/.out/`. */
	readonly outDir?: string;
	/** Also run `@typespec/openapi3`, so an arm can compare the two artefacts a consumer receives. */
	readonly withDocument?: boolean;
	/** Anything else the emitter accepts, for an option a single suite exercises. */
	readonly extraOptions?: Readonly<Record<string, unknown>>;
	/**
	 * The OpenAPI versions openapi3 publishes, which the library reads from the same options. Unset,
	 * as the README leaves it, the library reads openapi3's default, `3.0.0`.
	 */
	readonly openapiVersions?: readonly string[];
}

export async function compileFixture(
	dir: string,
	name: string,
	options: FixtureOptions = {},
): Promise<CompiledFixture> {
	const outDir = options.outDir ?? join(dir, ".out", options.outName ?? name);
	/**
	 * **Emptied first, so an assertion cannot be answered by the previous run.**
	 *
	 * An emitter that stops writing a file leaves the last one on disk, and every oracle reading that
	 * directory keeps passing. Deleting rather than overwriting is also the only way an arm can
	 * assert a file is ABSENT, which a refusal has to be able to prove.
	 */
	rmSync(outDir, { recursive: true, force: true });
	const program = await compile(NodeHost, join(dir, `${name}.tsp`), {
		outputDir: outDir,
		emit:
			options.withDocument === true
				? ["typespec-http-mcp", "@typespec/openapi3"]
				: ["typespec-http-mcp"],
		options: {
			"@typespec/openapi3": {
				"emitter-output-dir": join(outDir, "openapi"),
				"file-type": "json",
				...(options.openapiVersions === undefined
					? {}
					: { "openapi-versions": [...options.openapiVersions] }),
			},
			/**
			 * **Nothing set but the output directory, unless a suite asks for an option**, which is the
			 * configuration the README produces. A harness that configured the runtime away used to mean
			 * nothing compiled the shipped default: `runtime-module` was set by every fixture, and in the
			 * sibling package the default it hid pointed at a module that resolved from nowhere. The
			 * option is refused now, so every compile uses the runtime this package emits.
			 */
			"typespec-http-mcp": { "emitter-output-dir": outDir, ...options.extraOptions },
		},
	});
	return {
		outDir,
		documentDir: join(outDir, "openapi"),
		diagnostics: program.diagnostics.map((d) => ({ code: d.code, severity: d.severity })),
		messages: program.diagnostics.map((d) => ({
			code: d.code,
			message: typeof d.message === "string" ? d.message : String(d.message),
		})),
	};
}
