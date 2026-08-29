import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { annotationsFor } from "../../src/annotations.js";

/**
 * **The tool hints, graded against IANA's HTTP Method Registry.**
 *
 * `src/annotations.ts` holds its own table of safe and idempotent methods. An arm that recomputed
 * `verb in {GET, HEAD}` from that same table would agree with any mistake in it -- it would restate
 * the emitter rather than grade it. This reads the registry IANA publishes, vendored and pinned, so
 * the two can genuinely disagree.
 */

const csv = readFileSync(
	fileURLToPath(new URL("../reference/vendored/methods.csv", import.meta.url)),
	"utf8",
);

interface Registered {
	readonly method: string;
	readonly safe: boolean;
	readonly idempotent: boolean;
}

/** `Method Name,Safe,Idempotent,Reference`, with the reference column quoted. */
const REGISTRY: readonly Registered[] = csv
	.split("\n")
	.slice(1)
	.filter((line) => line.trim() !== "")
	.map((line) => {
		const [method, safe, idempotent] = line.split(",");
		return {
			method: (method ?? "").trim(),
			safe: (safe ?? "").trim() === "yes",
			idempotent: (idempotent ?? "").trim() === "yes",
		};
	})
	.filter((row) => /^[A-Z-]+$/.test(row.method));

/** The methods a TypeSpec `@route` can actually carry. */
const VERBS = ["get", "head", "post", "put", "patch", "delete"];

describe("the registry is a usable oracle", () => {
	it("parsed enough rows to grade against", () => {
		expect(REGISTRY.length).toBeGreaterThanOrEqual(30);
	});

	it("covers every verb this emitter can see", () => {
		const missing = VERBS.filter(
			(verb) => !REGISTRY.some((row) => row.method === verb.toUpperCase()),
		);
		expect(missing).toEqual([]);
	});

	/**
	 * **The registry must disagree across its own rows, or every comparison below is trivial.** A
	 * table where every method were safe would grade an emitter that marked everything read-only as
	 * correct.
	 */
	it("distinguishes methods from one another", () => {
		expect(REGISTRY.filter((row) => row.safe).length).toBeGreaterThanOrEqual(2);
		expect(REGISTRY.filter((row) => !row.safe).length).toBeGreaterThanOrEqual(4);
		expect(REGISTRY.filter((row) => row.idempotent && !row.safe).length).toBeGreaterThanOrEqual(2);
	});
});

describe("what the emitter states about a method matches what IANA publishes", () => {
	it("marks readOnlyHint on exactly the safe methods", () => {
		const disagreements: string[] = [];
		for (const verb of VERBS) {
			const row = REGISTRY.find((entry) => entry.method === verb.toUpperCase());
			const stated = annotationsFor(verb).readOnlyHint === true;
			if (stated !== row?.safe) disagreements.push(`${verb}: emitter ${stated}, IANA ${row?.safe}`);
		}
		expect(disagreements).toEqual([]);
	});

	it("marks idempotentHint on exactly the idempotent methods", () => {
		const disagreements: string[] = [];
		for (const verb of VERBS) {
			const row = REGISTRY.find((entry) => entry.method === verb.toUpperCase());
			const stated = annotationsFor(verb).idempotentHint;
			if (stated !== row?.idempotent) {
				disagreements.push(`${verb}: emitter ${String(stated)}, IANA ${String(row?.idempotent)}`);
			}
		}
		expect(disagreements).toEqual([]);
	});
});

describe("what the emitter deliberately does not state", () => {
	/**
	 * `destructiveHint` has no entry in any registry -- it is MCP's concept, not RFC 9110's. So it is
	 * held by two DERIVED class assertions instead, each read from the registry rather than from the
	 * emitter's own table.
	 */
	it("never calls a safe method destructive, which is what safe MEANS", () => {
		for (const row of REGISTRY.filter((entry) => entry.safe)) {
			const annotations = annotationsFor(row.method.toLowerCase());
			expect(annotations.destructiveHint, row.method).not.toBe(true);
		}
	});

	it("never marks a method read-only without also marking it idempotent (RFC 9110 s9.2.2)", () => {
		for (const verb of VERBS) {
			const annotations = annotationsFor(verb);
			if (annotations.readOnlyHint === true) expect(annotations.idempotentHint, verb).toBe(true);
		}
	});

	it("writes readOnlyHint only when true, because false is MCP's default and says nothing", () => {
		expect(annotationsFor("post").readOnlyHint).toBeUndefined();
		expect(annotationsFor("get").readOnlyHint).toBe(true);
	});

	it("writes destructiveHint only for DELETE, leaving MCP's default to stand elsewhere", () => {
		expect(annotationsFor("delete").destructiveHint).toBe(true);
		for (const verb of ["post", "patch", "put", "get", "head"]) {
			expect(annotationsFor(verb).destructiveHint, verb).toBeUndefined();
		}
	});

	it("never writes openWorldHint, which no OpenAPI keyword states", () => {
		for (const verb of VERBS) {
			expect(Object.keys(annotationsFor(verb))).not.toContain("openWorldHint");
		}
	});

	/**
	 * **Non-vacuity for the whole file.** An emitter that returned the same annotations for every
	 * method would satisfy several arms above. This requires the verbs to be genuinely distinguished.
	 */
	it("produces distinct annotation sets across the verbs", () => {
		const distinct = new Set(VERBS.map((verb) => JSON.stringify(annotationsFor(verb))));
		expect(distinct.size).toBeGreaterThanOrEqual(4);
	});
});
