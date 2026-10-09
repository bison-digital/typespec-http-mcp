import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONTENTLESS_STATUS_CODES, STATUS_CODES } from "typespec-http-zod";

/**
 * Hono's name for each class, which is what its declaration file spells. The codes are the library's,
 * which owns the one table every emitter types a result from; this package no longer keeps a copy.
 */
const HONO_CLASS_NAMES = {
	1: "InfoStatusCode",
	2: "SuccessStatusCode",
	3: "RedirectStatusCode",
	4: "ClientErrorStatusCode",
	5: "ServerErrorStatusCode",
} as const;

/**
 * **The status literals a result type is written from, held equal to Hono's own.**
 *
 * `typespec-hono` types a handler's `status` with Hono's status-code unions, and this package writes
 * the same sets as literal unions because its output imports no Hono. A code Hono adds to
 * `ClientErrorStatusCode` would be part of the server's `4XX` response type and missing from the tool
 * surface's, so the one handler object both surfaces share would compile against one and not the
 * other.
 *
 * **Read from the installed declaration file, never from this package**, so the expectation comes
 * from outside the code it grades. `hono` is a devDependency for exactly this and the agreement arm.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const declarations = readFileSync(
	join(here, "..", "..", "node_modules", "hono", "dist", "types", "utils", "http-status.d.ts"),
	"utf8",
);

/**
 * The numeric literals of one exported union type in Hono's declaration file, following the aliases
 * it is built from -- `RedirectStatusCode` names `DeprecatedStatusCode` for 305 and 306.
 */
function honoCodes(name: string): number[] {
	const declared = new RegExp(`export type ${name} = ([^;]+);`).exec(declarations)?.[1];
	if (declared === undefined) throw new Error(`hono declares no ${name}`);
	const members = declared.split("|").map((member) => member.trim());
	return members
		.flatMap((member) => (/^\d{3}$/.test(member) ? [Number(member)] : honoCodes(member)))
		.toSorted((a, b) => a - b);
}

describe("the emitter's status literals are Hono's", () => {
	it.each(
		([1, 2, 3, 4, 5] as const).map((digit) => ({
			type: HONO_CLASS_NAMES[digit],
			codes: STATUS_CODES[digit],
		})),
	)("$type", ({ type, codes }) => {
		const expected = honoCodes(type);
		// Non-vacuity: a regex that matched nothing would compare an empty list against itself.
		expect(expected.length).toBeGreaterThanOrEqual(4);
		expect([...codes].toSorted((a, b) => a - b)).toEqual(expected);
	});

	it("ContentlessStatusCode", () => {
		expect([...CONTENTLESS_STATUS_CODES].toSorted((a, b) => a - b)).toEqual(
			honoCodes("ContentlessStatusCode"),
		);
	});

	/**
	 * **Every group Hono's `StatusCode` is built from is compared above**, apart from the unofficial
	 * `-1`, which no document can declare. A group Hono added to `StatusCode` would be a status the
	 * server types and this package does not know exists.
	 */
	it("covers every group StatusCode is made of", () => {
		const declared = /export type StatusCode = ([^;]+);/.exec(declarations)?.[1] ?? "";
		const groups = declared
			.split("|")
			.map((member) => member.trim())
			.filter((member) => member !== "UnofficialStatusCode")
			.toSorted();
		expect(groups.length).toBeGreaterThanOrEqual(5);
		expect(groups).toEqual(Object.values(HONO_CLASS_NAMES).toSorted());
	});
});
