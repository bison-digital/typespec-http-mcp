import { execFileSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compile, NodeHost } from "@typespec/compiler";
import { beforeAll, describe, expect, it } from "vitest";
import { corpusScenarios, packageRoot } from "./scenarios.js";

/**
 * **Every tool's signature IS the server handler's, over every scenario the corpus declares.**
 *
 * `test/agreement` proves it for one hand-written service, and one service is what let the two
 * emitters drift: an empty model contributed `unknown` to a handler's input here and `{}` there, and
 * nothing declared one. The sibling server emitter's own corpus oracle found that shape; this is
 * the same oracle pointed at the pair, so the next shape is found here as well.
 *
 * Each scenario is compiled through BOTH emitters in ONE program, as an application wanting both
 * surfaces compiles it, and one consumer per scenario asserts:
 *
 * - **the same operations**: the tool surface's `DeclaredOperationId` is `keyof Operations`, so a
 *   refusal is a tool left out, never an operation the two disagree exists;
 * - **no tool the server lacks**: `keyof Tools` is within `keyof Operations`;
 * - **one signature**: `Tools[K]` is `Operations[K]` for every tool, by `Identical`, so a tool input
 *   wider or narrower than the handler's cannot pass on assignability.
 */

const outputRoot = join(packageRoot, "test", ".out-corpus-agreement");

interface Compiled {
	readonly name: string;
	readonly dir: string;
	readonly errors: readonly string[];
}

let compiled: Compiled[] = [];

beforeAll(async () => {
	rmSync(outputRoot, { recursive: true, force: true });
	const collected: Compiled[] = [];
	for (const { name, main } of corpusScenarios()) {
		const dir = join(outputRoot, name);
		const shared = { "emitter-output-dir": dir };
		const program = await compile(NodeHost, main, {
			outputDir: dir,
			emit: ["typespec-hono", "typespec-http-mcp"],
			options: { "typespec-hono": shared, "typespec-http-mcp": shared },
		});
		collected.push({
			name,
			dir,
			errors: program.diagnostics.filter((d) => d.severity === "error").map((d) => d.code),
		});
	}
	compiled = collected;
}, 1_800_000);

const CONSUMER = `import type { Operations } from "./app.gen.js";
import type { DeclaredOperationId, Tools } from "./mcp.gen.js";

type Identical<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type MustHold<T extends true> = T;
/** The keys whose entry is not \`true\`, so a failure names the operations it fails on. */
type Failing<M> = { [K in keyof M]: M[K] extends true ? never : K }[keyof M];

interface Caller {
	readonly subject: string;
}
type T = Tools<Caller>;
type O = Operations<Caller>;

export type SameOperations = MustHold<Identical<DeclaredOperationId, keyof O>>;
export type NoToolTheServerLacks = MustHold<Identical<Exclude<keyof T, keyof O>, never>>;

type Signatures = { [K in keyof T]: K extends keyof O ? Identical<T[K], O[K]> : false };
export type OneSignature = MustHold<Identical<Failing<Signatures>, never>>;
`;

function typecheck(dir: string): string {
	writeFileSync(join(dir, "agreement.consumer.ts"), CONSUMER);
	const config = join(dir, "tsconfig.agreement.json");
	writeFileSync(
		config,
		JSON.stringify({
			compilerOptions: {
				target: "es2023",
				lib: ["es2023", "dom"],
				module: "nodenext",
				moduleResolution: "nodenext",
				strict: true,
				exactOptionalPropertyTypes: true,
				noEmit: true,
				skipLibCheck: true,
				types: [],
			},
			include: ["./agreement.consumer.ts"],
		}),
	);
	try {
		execFileSync(
			join(packageRoot, "node_modules", ".bin", "tsc"),
			["-p", config, "--ignoreConfig"],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		);
		return "";
	} catch (error) {
		const asExec = error as { stdout?: string; stderr?: string };
		return `${asExec.stdout ?? ""}${asExec.stderr ?? ""}`.trim();
	}
}

describe("the tool surface and the server surface agree, over the corpus", () => {
	it("agrees for every scenario both emitters accept", () => {
		const both = compiled.filter(
			(entry) =>
				entry.errors.length === 0 &&
				existsSync(join(entry.dir, "app.gen.ts")) &&
				existsSync(join(entry.dir, "mcp.gen.ts")),
		);
		// Non-vacuity: the corpus is sixty-odd scenarios, and a discovery that found none agrees.
		expect(both.length).toBeGreaterThanOrEqual(55);
		const disagreements: string[] = [];
		for (const entry of both) {
			const output = typecheck(entry.dir);
			if (output !== "") disagreements.push(`${entry.name}\n${output}`);
		}
		expect(disagreements, disagreements.join("\n\n")).toEqual([]);
	}, 1_800_000);
});
