import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const specs = join(packageRoot, "node_modules", "@typespec", "http-specs", "specs");

/** One scenario `@typespec/http-specs` declares: its entry point, and a name safe as a directory. */
export interface ScenarioSource {
	readonly name: string;
	readonly main: string;
}

function mainsUnder(dir: string, found: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) mainsUnder(full, found);
		else if (entry.name === "main.tsp") found.push(full);
	}
	return found;
}

/** Every scenario the corpus declares, named by its path with `/` spelt `__`. */
export function corpusScenarios(): ScenarioSource[] {
	return mainsUnder(specs).map((main) => ({
		name: main
			.slice(specs.length + 1)
			.replace(/\/main\.tsp$/, "")
			.replaceAll("/", "__"),
		main,
	}));
}
