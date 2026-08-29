import { armFor as libraryArmFor } from "typespec-http-zod/runtime";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { armFor, type ResponseArm } from "../../src/runtime.js";

/**
 * **This package declares its own `ResponseArm` and `armFor`, and that is a deliberate second
 * implementation of one rule.**
 *
 * It cannot import the library's: the emitted `schemas.gen.ts` imports `ResponseArm` from whatever
 * `runtime-module` names, and emitted output must never import this emitter or the library it runs,
 * because a consumer installs both as devDependencies. So the duplication is forced.
 *
 * What is not forced is letting the two drift. This grades mine against the library's own for every
 * arm shape and every status class -- exact code, range, catch-all, and the orders in which they can
 * be declared.
 */

const schema = z.object({ ok: z.boolean() });

/** Every shape a response arm set can take, including the orders that make precedence observable. */
const ARM_SETS: readonly (readonly ResponseArm[])[] = [
	[{ status: 200, schema }],
	[{ status: 200, schema: undefined }],
	[
		{ status: 204, schema: undefined },
		{ status: 200, schema },
	],
	[
		{ status: 404, schema },
		{ status: "4XX", schema },
	],
	// Declared range-first, so a naive implementation that returns the first match gets it wrong.
	[
		{ status: "4XX", schema },
		{ status: 404, schema },
	],
	[
		{ status: "default", schema },
		{ status: 404, schema },
	],
	[
		{ status: 200, schema },
		{ status: "4XX", schema },
		{ status: "default", schema },
	],
	[
		{ status: "5XX", schema },
		{ status: "default", schema },
	],
	[{ status: "default", schema }],
	[],
];

const STATUSES = [200, 201, 204, 301, 400, 401, 404, 409, 418, 422, 500, 502, 599];

describe("armFor answers exactly as the library's own does", () => {
	it("agrees on every arm set and every status", () => {
		const disagreements: string[] = [];
		let compared = 0;
		for (const arms of ARM_SETS) {
			for (const status of STATUSES) {
				compared += 1;
				const mine = armFor(arms, status);
				const theirs = libraryArmFor(arms, status);
				if (mine?.status !== theirs?.status) {
					disagreements.push(
						`${JSON.stringify(arms.map((a) => a.status))} @ ${status}: ` +
							`${String(mine?.status)} vs ${String(theirs?.status)}`,
					);
				}
			}
		}
		expect(disagreements).toEqual([]);
		// Non-vacuity: an empty arm set list would agree about nothing.
		expect(compared).toBe(ARM_SETS.length * STATUSES.length);
		expect(compared).toBeGreaterThanOrEqual(120);
	});

	/**
	 * **The comparison above is only meaningful if these arms can tell implementations apart.**
	 *
	 * A set where every status resolves to the same arm would agree under any rule, including a wrong
	 * one. This asserts the fixtures actually exercise the precedence order.
	 */
	it("the arm sets distinguish exact code from range from catch-all", () => {
		const exact = armFor(
			[
				{ status: 404, schema },
				{ status: "4XX", schema },
			],
			404,
		);
		expect(exact?.status).toBe(404);

		// Declared range-first: precedence is by KIND, not by declaration order.
		const rangeFirst = armFor(
			[
				{ status: "4XX", schema },
				{ status: 404, schema },
			],
			404,
		);
		expect(rangeFirst?.status).toBe(404);

		const range = armFor(
			[
				{ status: 404, schema },
				{ status: "4XX", schema },
			],
			409,
		);
		expect(range?.status).toBe("4XX");

		const fallback = armFor(
			[
				{ status: "default", schema },
				{ status: 404, schema },
			],
			500,
		);
		expect(fallback?.status).toBe("default");

		expect(armFor([], 200)).toBeUndefined();
	});
});
