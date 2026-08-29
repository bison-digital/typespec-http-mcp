import type { Program } from "@typespec/compiler";

/**
 * **Two emitters writing one file is a silent last-writer-wins, and the winner is decided by the
 * order of `emit:` in `tspconfig.yaml`.**
 *
 * `emitFile` has no duplicate-path detection -- measured in `@typespec/compiler@1.15.0`,
 * `dist/src/core/emitter-utils.js:19-27`, which does `mkdirp`, records the path and writes. Two
 * emitters that both run `typespec-http-zod` therefore both write `schemas.gen.ts`.
 *
 * Measured end to end on the published packages, with divergent `seal-object-schemas`:
 *
 * | `emit:` order | surviving `schemas.gen.ts` |
 * | --- | --- |
 * | server first, then library | 19 `z.object` -- unsealed |
 * | library first, then server | 11 `z.object`, 8 `z.strictObject` -- sealed |
 *
 * Exit 0 both times, no diagnostic either time, and the two files differ. In the first row the
 * server was generated believing schemas were sealed while the surviving file is not, so it
 * validates more permissively than the emitter that wrote it believed.
 *
 * **The collision is opt-in, which is why this is a warning and not a refusal.** With nothing
 * configured, `emitterOutputDir` defaults to `[outputDir, packageName]`
 * (`dist/src/core/program.js:367-369`), so each emitter writes into a directory of its own and
 * nothing collides. Only a consumer who deliberately points both at one directory can reach this --
 * and that is a good arrangement when the options match, because it is what makes one `Ctx`, one
 * `Result` and one set of validators serve both surfaces.
 */

/**
 * The options that decide what `typespec-http-zod` writes.
 *
 * **Only these.** An emitter that shares a directory but declares none of them is not running the
 * same library and is not contesting the same file -- `@typespec/openapi3` alongside a server
 * emitter is the ordinary case, and warning about it would be noise.
 */
const SHARED_LIBRARY_OPTIONS = [
	"contracts-output-dir",
	"contracts-package",
	"seal-object-schemas",
	"compile-schemas",
	"key-vocabularies",
	"runtime-module",
	"regenerate-hint",
] as const;

export interface Collision {
	readonly emitter: string;
	/** The library options the two emitters resolve differently. */
	readonly differing: readonly string[];
}

/** Reproduces the compiler's own default, so a comparison means the same thing unconfigured. */
function outputDirOf(program: Program, emitter: string): string | undefined {
	const options = program.compilerOptions.options?.[emitter] as Record<string, unknown> | undefined;
	const configured = options?.["emitter-output-dir"];
	if (typeof configured === "string") return configured;
	const base = program.compilerOptions.outputDir;
	return base === undefined ? undefined : `${base}/${emitter}`;
}

/**
 * Another emitter writing where this one writes, with library options that disagree.
 *
 * Returns nothing when the options MATCH: that arrangement produces byte-identical content and is
 * the one worth encouraging.
 */
export function collisionsFor(program: Program, self: string, selfOutputDir: string): Collision[] {
	const collisions: Collision[] = [];
	const mine = program.compilerOptions.options?.[self] as Record<string, unknown> | undefined;

	for (const emitter of program.compilerOptions.emit ?? []) {
		if (emitter === self) continue;
		if (outputDirOf(program, emitter) !== selfOutputDir) continue;

		const theirs = program.compilerOptions.options?.[emitter] as
			| Record<string, unknown>
			| undefined;
		// An emitter declaring none of these is not running the same library.
		const declaresAny = SHARED_LIBRARY_OPTIONS.some((key) => theirs?.[key] !== undefined);
		if (!declaresAny) continue;

		const differing = SHARED_LIBRARY_OPTIONS.filter((key) => {
			const a = mine?.[key];
			const b = theirs?.[key];
			return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
		});
		if (differing.length > 0) collisions.push({ emitter, differing });
	}
	return collisions;
}
