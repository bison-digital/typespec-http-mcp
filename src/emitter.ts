import type { DiagnosticTarget, EmitContext } from "@typespec/compiler";
import { NoTarget } from "@typespec/compiler";
import { emitHttpZod, type EmittedService } from "typespec-http-zod";
import type { EmitterOptions } from "./lib.js";
import { reportDiagnostic } from "./lib.js";
import { nameTools } from "./names.js";
import { httpOperationFor, selectTools } from "./select.js";

/**
 * Where emitted output imports its runtime from, when the consumer has not substituted one.
 *
 * **Deliberately NOT `./runtime.gen.js`, which is what the sibling server emitter uses.** Both
 * emitters run `typespec-http-zod`, and a consumer who wants both surfaces may point them at one
 * output directory. `emitFile` has no duplicate-path detection -- measured, `@typespec/compiler`
 * 1.15.0 `dist/src/core/emitter-utils.js:19-27` -- so two emitters writing one path is a silent
 * last-writer-wins whose winner is decided by the ORDER of `emit:` in `tspconfig.yaml`. Measured
 * end to end: with divergent `seal-object-schemas`, one order produced 19 unsealed objects and the
 * other 11 unsealed plus 8 sealed, exit 0 and no diagnostic either time.
 *
 * Giving this package its own runtime filename means the only file the two can contest is
 * `schemas.gen.ts`, which is byte-identical under identical options.
 */
export const DEFAULT_RUNTIME_MODULE = "./mcp-runtime.gen.js";

/** The per-service view of the options, after the top-level defaults have been applied. */
interface ResolvedToolOptions {
	readonly emitTools: boolean;
	readonly toolTags: readonly string[] | undefined;
	readonly excludeTags: readonly string[];
	readonly toolPrefix: string | undefined;
}

function resolveToolOptions(options: EmitterOptions, serviceName: string): ResolvedToolOptions {
	const perService = options.services?.[serviceName];
	return {
		emitTools: perService?.["emit-tools"] ?? true,
		toolTags: perService?.["tool-tags"] ?? options["tool-tags"],
		excludeTags: perService?.["exclude-tags"] ?? options["exclude-tags"] ?? [],
		toolPrefix: perService?.["tool-prefix"] ?? options["tool-prefix"],
	};
}

/**
 * Where a diagnostic about an operation should point.
 *
 * **Keyed on verb and path, never on operation name.** Matching by name never succeeds for an
 * operation declared inside an `interface`, which is most of them -- a defect this estate has
 * already paid for once, where a whole class of refusal silently pointed at nothing.
 */
function targetFor(
	emitted: EmittedService,
	operationId: string,
): DiagnosticTarget | typeof NoTarget {
	const route = emitted.routes.find((candidate) => candidate.operationId === operationId);
	if (route === undefined) return NoTarget;
	return httpOperationFor(emitted.service, route)?.operation ?? NoTarget;
}

/**
 * Run the library, then add the MCP surface beside what it wrote.
 *
 * **This file may import only `./lib.js`, its own modules, the library's public API and external
 * packages.** The same rule the library's own emitter entry point holds itself to, and for the same
 * reason: it makes "the published API is sufficient to build an emitter on" true by construction
 * rather than by assertion.
 */
export async function $onEmit(context: EmitContext): Promise<void> {
	const options = context.options as EmitterOptions;

	for (const emitted of await emitHttpZod(context, {
		defaultRuntimeModule: DEFAULT_RUNTIME_MODULE,
	})) {
		const serviceName = emitted.service.namespace.name;
		const resolved = resolveToolOptions(options, serviceName);
		if (!resolved.emitTools) continue;

		const selection = selectTools(context.program, emitted.service, emitted.routes, {
			toolTags: resolved.toolTags,
			excludeTags: resolved.excludeTags,
		});

		if (selection.selected.length === 0) {
			reportDiagnostic(context.program, {
				code: "no-tools-selected",
				target: NoTarget,
				format: {
					service: serviceName,
					configured:
						resolved.toolTags === undefined
							? "(unset, so every operation)"
							: resolved.toolTags.join(", "),
					available: selection.available.length === 0 ? "(none)" : selection.available.join(", "),
				},
			});
			continue;
		}

		const named = nameTools(selection.selected, resolved.toolPrefix);

		for (const refused of named.unrepresentable) {
			reportDiagnostic(context.program, {
				code: "unrepresentable-tool-name",
				target: targetFor(emitted, refused.operationId),
				format: { name: refused.name },
			});
		}
		for (const collision of named.collisions) {
			reportDiagnostic(context.program, {
				code: "tool-name-collision",
				target: targetFor(emitted, collision.second),
				format: { first: collision.first, second: collision.second, name: collision.name },
			});
		}
	}
}
