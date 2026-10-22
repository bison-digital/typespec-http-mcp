import { describe, expect, it } from "vitest";
import { isRepresentable, nameTools, toolNameFor } from "../../src/names.js";

describe("a tool name is the operation id, never a re-spelling of it", () => {
	it("passes the id through untouched when no prefix is set", () => {
		expect(toolNameFor("WidgetTools_read", undefined)).toBe("WidgetTools_read");
	});

	it("prepends the prefix verbatim, so the author owns the separator", () => {
		expect(toolNameFor("read", "widgets.")).toBe("widgets.read");
		expect(toolNameFor("read", "widgets_")).toBe("widgets_read");
	});
});

describe("MCP's name rule, enforced rather than approximated", () => {
	it("accepts the shapes the specification lists", () => {
		for (const name of ["getUser", "DATA_EXPORT_v2", "admin.tools.list", "a", "a-b.c_d"]) {
			expect(isRepresentable(name)).toBe(true);
		}
	});

	it("refuses what MCP does not permit", () => {
		// `$` reaches an operation id through a template instantiation, so this is not hypothetical.
		for (const name of ["list$Items", "has space", "has,comma", "", "a".repeat(129)]) {
			expect(isRepresentable(name)).toBe(false);
		}
	});

	it("accepts exactly 128 characters and refuses 129, so the boundary is the stated one", () => {
		expect(isRepresentable("a".repeat(128))).toBe(true);
		expect(isRepresentable("a".repeat(129))).toBe(false);
	});
});

describe("naming reports what it cannot name", () => {
	it("names everything representable", () => {
		const { names, unrepresentable, collisions } = nameTools(["read", "create"], undefined);
		expect([...names.entries()]).toEqual([
			["read", "read"],
			["create", "create"],
		]);
		expect(unrepresentable).toEqual([]);
		expect(collisions).toEqual([]);
	});

	it("refuses an unrepresentable name and reports the name it would have had", () => {
		const { names, unrepresentable } = nameTools(["list$Items", "read"], undefined);
		expect(names.has("list$Items")).toBe(false);
		expect(unrepresentable).toEqual([{ operationId: "list$Items", name: "list$Items" }]);
		// The survivor is still named, so one refusal does not take the surface with it.
		expect(names.get("read")).toBe("read");
	});

	it("refuses a name a PREFIX made unrepresentable", () => {
		const { names, unrepresentable } = nameTools(["read"], "a".repeat(130));
		expect(names.size).toBe(0);
		expect(unrepresentable).toHaveLength(1);
	});

	/**
	 * **BOTH sides of a collision are refused, and that is the load-bearing arm here.**
	 *
	 * Keeping one would make the tool surface depend on which operation the emitter reached first --
	 * a tool that answers, as the wrong operation. Absent and diagnosed beats present and wrong.
	 */
	it("refuses BOTH operations that collide, not just the second", () => {
		// Two distinct ids that a prefix cannot separate: the ids themselves are equal after naming.
		const { names, collisions } = nameTools(["dup", "dup"], undefined);
		expect(names.has("dup")).toBe(false);
		expect(names.size).toBe(0);
		expect(collisions).toEqual([{ name: "dup", first: "dup", second: "dup" }]);
	});

	it("a collision does not remove an unrelated tool", () => {
		const { names } = nameTools(["dup", "dup", "other"], undefined);
		expect(names.get("other")).toBe("other");
		expect(names.size).toBe(1);
	});
});
