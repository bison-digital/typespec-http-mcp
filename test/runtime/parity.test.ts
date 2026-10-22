import {
	armFor as libraryArmFor,
	type ResponseArm as LibraryResponseArm,
} from "typespec-http-zod/runtime";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z, type ZodType } from "zod";
import { armFor, type ResponseArm } from "../../src/runtime.js";

/**
 * **This package declares its own `ResponseArm` and `armFor`, and that is a deliberate second
 * implementation of one rule.**
 *
 * It cannot import the library's: the runtime is copied into the consumer's output as
 * `mcp-runtime.gen.ts`, and emitted output must never import this emitter or the library it runs,
 * because a consumer installs both as devDependencies. So the duplication is forced.
 *
 * What is not forced is letting the two drift. This grades this package's against the library's own
 * for every arm shape and every status class -- exact code, range, catch-all, and the orders in which
 * they can be declared -- and holds the two declarations to one type.
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

/**
 * The library's view of an arm set, for the comparison below.
 *
 * **`schema` is dropped, and nothing the comparison grades is lost with it.** `armFor` reads only
 * `status`, and the comparison is of the status each implementation resolves to. The schema cannot be
 * handed over as it is where the library is linked from a sibling checkout: that checkout resolves its
 * own copy of Zod, and two copies' `ZodType`s are different types to the compiler. An installed
 * package shares the consumer's, through its peer dependency.
 */
function libraryArms(arms: readonly ResponseArm[]): Parameters<typeof libraryArmFor>[0] {
	return arms.map(({ schema: _schema, ...rest }) => ({ ...rest, schema: undefined }));
}

describe("the arm is the library's arm", () => {
	/**
	 * **The same TYPE, not merely a compatible one.** The emitted `schemas.gen.ts` annotates its arm
	 * lists with the library's shape and `toolResult` reads them through this one, so a field one side
	 * gained and the other did not would be an arm this runtime silently ignores.
	 *
	 * Every field but `schema` is compared directly. `schema` is typed by each package's own Zod, which
	 * is one copy in an install and two in a linked checkout (see `libraryArms`), so it is compared to
	 * the Zod this package resolves instead.
	 */
	it("declares exactly the library's ResponseArm", () => {
		expectTypeOf<Omit<ResponseArm, "schema">>().toEqualTypeOf<Omit<LibraryResponseArm, "schema">>();
		expectTypeOf<ResponseArm["schema"]>().toEqualTypeOf<ZodType | undefined>();
		expectTypeOf<keyof ResponseArm>().toEqualTypeOf<keyof LibraryResponseArm>();
	});
});

describe("armFor answers exactly as the library's own does", () => {
	it("agrees on every arm set and every status", () => {
		const disagreements: string[] = [];
		let compared = 0;
		for (const arms of ARM_SETS) {
			for (const status of STATUSES) {
				compared += 1;
				const mine = armFor(arms, status);
				const theirs = libraryArmFor(libraryArms(arms), status);
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
