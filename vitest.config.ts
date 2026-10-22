import { defineConfig } from "vitest/config";

/**
 * The emitter is a build-time tool, not Workers code, plain Node. The suite compiles TypeSpec and
 * shells out to `tsc`, so it needs headroom well past the 5s default.
 *
 * **No `globalSetup`.** Each suite compiles what it needs through its own harness. A `globalSetup`
 * naming a file that does not exist fails the whole run before a single test is collected.
 *
 * **Two projects, split by what a suite COSTS rather than by what it grades.** `system` holds the
 * two arms that compile the whole corpus and start a real worker; together they are most of the
 * wall clock, and neither is something anybody wants to wait for while editing a renderer. `unit`
 * is everything else and finishes in a couple of seconds.
 *
 * `pnpm test` runs BOTH and its meaning is unchanged -- the split is for the edit loop
 * (`pnpm test:unit`), not for the gate. A split that quietly took suites out of `pnpm test` would
 * be the narrowing this repository refuses.
 */
const SYSTEM = ["test/conformance/**/*.test.ts", "test/socket/**/*.test.ts"];

export default defineConfig({
	test: {
		testTimeout: 180_000,
		projects: [
			{
				test: {
					name: "unit",
					environment: "node",
					include: ["test/**/*.test.ts"],
					exclude: SYSTEM,
					testTimeout: 180_000,
				},
			},
			{
				test: {
					name: "system",
					environment: "node",
					include: SYSTEM,
					testTimeout: 1_800_000,
				},
			},
		],
	},
});
