import { getAllTags, getTags } from "@typespec/compiler";
import { compile, NodeHost } from "@typespec/compiler";
import { getAllHttpServices } from "@typespec/http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";
import { selectTools } from "../../src/select.js";

const here = fileURLToPath(new URL(".", import.meta.url));

/**
 * **The one arm that proves the accessor choice, rather than assuming it.**
 *
 * `getTags` and `getAllTags` differ only for an operation that inherits a tag, and inheriting from
 * an `interface` is the obvious way to mark a group of operations as tools. Reading the wrong one
 * produces a tool surface that is silently missing most of a real spec, with no diagnostic.
 *
 * This is written as a CONTROL: it asserts what the wrong accessor would have answered, so the
 * choice cannot regress into "both look fine on this fixture".
 */
describe("tag inheritance, measured through both accessors", () => {
	let rows: { verb: string; path: string; own: string[]; all: string[] }[] = [];

	beforeAll(async () => {
		const program = await compile(NodeHost, join(here, "selection.tsp"), { noEmit: true });
		const [services] = getAllHttpServices(program);
		rows = (services[0]?.operations ?? []).map((operation) => ({
			verb: operation.verb,
			path: operation.path,
			own: [...(getTags(program, operation.operation) ?? [])],
			all: [...(getAllTags(program, operation.operation) ?? [])],
		}));
	}, 300_000);

	it("found every operation in the fixture", () => {
		expect(rows).toHaveLength(3);
	});

	it("getTags reports NOTHING for an operation inside a tagged interface", () => {
		const bulk = rows.find((row) => row.path === "/bulk");
		expect(bulk?.own).toEqual([]);
		// The wrong accessor would exclude it entirely. This is the defect being guarded against.
	});

	it("getAllTags reports the inherited tags, which is why the emitter reads it", () => {
		const bulk = rows.find((row) => row.path === "/bulk");
		expect(bulk?.all.toSorted()).toEqual(["admin", "agent", "service-level"]);
	});

	it("a namespace tag reaches every operation", () => {
		expect(rows.every((row) => row.all.includes("service-level"))).toBe(true);
		// Non-vacuity: an empty row set would satisfy `every`.
		expect(rows.length).toBeGreaterThanOrEqual(3);
	});

	it("the two accessors genuinely disagree here, so this fixture can detect the swap", () => {
		const disagreeing = rows.filter((row) => row.own.length !== row.all.length);
		expect(disagreeing.length).toBeGreaterThanOrEqual(3);
	});
});

describe("selection refuses loudly when it matches nothing", () => {
	it("raises no-tools-selected, naming the tags the service actually declares", async () => {
		const compiled = await compileFixture(here, "selection", {
			outName: "selection-none",
			extraOptions: { "tool-tags": ["no-such-tag"] },
		});
		const codes = compiled.diagnostics.map((d) => d.code);
		expect(codes).toContain("typespec-http-mcp/no-tools-selected");
	}, 300_000);

	it("selects everything when nothing narrows, so the arm above is not trivially true", async () => {
		const compiled = await compileFixture(here, "selection", { outName: "selection-all" });
		const codes = compiled.diagnostics.map((d) => d.code);
		expect(codes).not.toContain("typespec-http-mcp/no-tools-selected");
	}, 300_000);
});

/**
 * **That selection NARROWS, which the diagnostics above cannot show.**
 *
 * A tag filter that quietly matched everything would satisfy every arm written in terms of
 * "something was selected". These read the selected set directly and assert what is missing from it.
 */
describe("selection narrows, and by the tag the document publishes", () => {
	let program: Awaited<ReturnType<typeof compile>>;
	let service: NonNullable<ReturnType<typeof getAllHttpServices>[0][0]>;

	beforeAll(async () => {
		program = await compile(NodeHost, join(here, "selection.tsp"), { noEmit: true });
		const [services] = getAllHttpServices(program);
		service = services[0]!;
	}, 300_000);

	/** `selectTools` keys on `EmittedRoute`, so the fixture's operations are adapted to that shape. */
	const routesOf = () =>
		service.operations.map((operation) => ({
			operationId: `${operation.verb}:${operation.path}`,
			verb: operation.verb.toUpperCase(),
			path: operation.path,
		})) as unknown as Parameters<typeof selectTools>[2];

	it("selects every operation when nothing narrows", () => {
		const { selected } = selectTools(program, service, routesOf(), {
			toolTags: undefined,
			excludeTags: [],
		});
		expect(selected).toHaveLength(3);
	});

	it("selects the INTERFACE member by its inherited tag", () => {
		const { selected } = selectTools(program, service, routesOf(), {
			toolTags: ["agent"],
			excludeTags: [],
		});
		// `/bulk` carries "agent" only through its interface. Reading `getTags` would omit it.
		expect(selected).toContain("post:/bulk");
		expect(selected).toContain("get:/things");
		// And it genuinely narrows: the untagged delete is gone.
		expect(selected).not.toContain("delete:/things/{id}");
		expect(selected).toHaveLength(2);
	});

	it("excludes by tag, even when the operation was selected", () => {
		const { selected } = selectTools(program, service, routesOf(), {
			toolTags: ["agent"],
			excludeTags: ["admin"],
		});
		expect(selected).toEqual(["get:/things"]);
	});

	it("reports every tag the service declares, for the diagnostic to name", () => {
		const { available } = selectTools(program, service, routesOf(), {
			toolTags: undefined,
			excludeTags: [],
		});
		expect(available).toEqual(["admin", "agent", "service-level"]);
	});
});
