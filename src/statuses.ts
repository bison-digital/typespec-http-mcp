/**
 * **The status codes a handler's result may name, as values, held equal to Hono's own types.**
 *
 * One handler object serves both the HTTP surface `typespec-hono` generates and this tool surface,
 * and `typespec-hono` types a result's `status` with Hono's status-code unions. This package's output
 * must not import Hono, so it writes the same sets as literal unions, and a type the two emitters
 * disagree on is a handler that compiles against one surface and not the other.
 * `test/runtime/status-codes.test.ts` reads Hono's declaration file and compares every set here with
 * it, and the agreement arm compiles the two emitted signatures against each other.
 */

/** Hono's `InfoStatusCode` to `ServerErrorStatusCode`, by the digit a range key starts with. */
export const STATUS_GROUPS = {
	1: { type: "InfoStatusCode", codes: [100, 101, 102, 103] },
	2: { type: "SuccessStatusCode", codes: [200, 201, 202, 203, 204, 205, 206, 207, 208, 226] },
	3: { type: "RedirectStatusCode", codes: [300, 301, 302, 303, 304, 305, 306, 307, 308] },
	4: {
		type: "ClientErrorStatusCode",
		codes: [
			400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 418,
			421, 422, 423, 424, 425, 426, 428, 429, 431, 451,
		],
	},
	5: {
		type: "ServerErrorStatusCode",
		codes: [500, 501, 502, 503, 504, 505, 506, 507, 508, 510, 511],
	},
} as const;

/** Hono's `ContentlessStatusCode`: a status that cannot carry a body. */
export const CONTENTLESS_STATUS_CODES = [101, 204, 205, 304] as const;
