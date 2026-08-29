import { describe, expect, it } from "vitest";
import { EmitterOptionsSchema as httpZodOptions } from "typespec-http-zod";
import { EmitterOptionsSchema } from "../src/lib.js";

/**
 * That every option `typespec-http-zod` accepts also reaches this emitter.
 *
 * **Graded as a CLASS, never as a list.** This emitter runs the whole library and adds files beside
 * its output, so an option the library gains has to arrive here. A hand-written list of expected
 * keys would pass forever while the library grew.
 *
 * This suite is also the named guard for the assertion in `src/lib.ts`: the schema is spread and then
 * asserted to its type, because the spread carries `dependencies`-family members typed over the
 * library's key set. A type error can no longer catch a spread that stopped forwarding. This can.
 */

type SchemaLike = {
	type: string;
	required: readonly string[];
	additionalProperties: boolean;
	properties: Record<string, unknown>;
};

const ours = EmitterOptionsSchema as unknown as SchemaLike;
const theirs = httpZodOptions as unknown as SchemaLike;

const serviceProperties = (schema: SchemaLike): Record<string, unknown> => {
	const services = schema.properties["services"] as {
		additionalProperties: { properties: Record<string, unknown> };
	};
	return services.additionalProperties.properties;
};

/** What this emitter adds on top, stated once so the arms below can subtract it. */
const ADDED_TOP_LEVEL = ["tool-tags", "exclude-tags", "tool-prefix"] as const;
const ADDED_PER_SERVICE = ["tool-tags", "exclude-tags", "tool-prefix", "emit-tools"] as const;

describe("the options schema forwards the library's", () => {
	it("carries every top-level option the library publishes", () => {
		const missing = Object.keys(theirs.properties).filter((key) => !(key in ours.properties));
		expect(missing).toEqual([]);
		// Non-vacuity: an empty library schema would satisfy the line above.
		expect(Object.keys(theirs.properties).length).toBeGreaterThanOrEqual(7);
	});

	it("carries every per-service option the library publishes", () => {
		const theirService = serviceProperties(theirs);
		const ourService = serviceProperties(ours);
		const missing = Object.keys(theirService).filter((key) => !(key in ourService));
		expect(missing).toEqual([]);
		expect(Object.keys(theirService).length).toBeGreaterThanOrEqual(1);
	});

	it("adds only what it declares, at both levels", () => {
		const extraTop = Object.keys(ours.properties).filter((key) => !(key in theirs.properties));
		expect(extraTop.toSorted()).toEqual([...ADDED_TOP_LEVEL].toSorted());

		const theirService = serviceProperties(theirs);
		const extraService = Object.keys(serviceProperties(ours)).filter(
			(key) => !(key in theirService),
		);
		expect(extraService.toSorted()).toEqual([...ADDED_PER_SERVICE].toSorted());
	});

	it("keeps the shape the compiler validates against", () => {
		expect(ours.type).toBe("object");
		expect(ours.additionalProperties).toBe(false);
		expect(serviceProperties(ours)).toBeTypeOf("object");
	});
});
