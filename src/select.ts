import { getAllTags, type Program } from "@typespec/compiler";
import type { HttpOperation, HttpService } from "@typespec/http";
import type { EmittedRoute } from "typespec-http-zod";

/**
 * Which operations become tools.
 *
 * **`getAllTags`, never `getTags`, and the difference is a silent defect.** `getTags` returns only an
 * operation's OWN tags, so an operation declared inside a `@tag`-carrying `interface` reports none.
 * Measured on a fixture tagging all three levels:
 *
 * ```
 * GET    /things       getTags: ["agent"]  getAllTags: ["service-level","agent"]
 * DELETE /things/{id}  getTags: []         getAllTags: ["service-level"]
 * POST   /bulk         getTags: []         getAllTags: ["service-level","agent","admin"]
 * ```
 *
 * where `/bulk` is a member of a tagged interface. Tagging a whole interface is the obvious way to
 * mark a group of operations as tools, so `getTags` would break the primary use case invisibly --
 * the same failure shape this estate already recorded for matching operations by NAME, which never
 * succeeded for an operation inside an `interface`.
 *
 * **A `@tag` on the service namespace propagates to every operation.** That is correct and
 * documented: it is how a whole service is marked, and it is also why a tag chosen for grouping and
 * a tag chosen for selection should not be the same word.
 *
 * Selection is by tag because `@typespec/openapi3` PUBLISHES tags. A reader of the document can see
 * exactly which operations are tools, which is what keeps this out of decorator territory.
 */
export interface Selection {
	/** Operation ids the tag configuration matched. */
	readonly selected: readonly string[];
	/** Every tag any operation in the service carries, for a diagnostic that has to be actionable. */
	readonly available: readonly string[];
}

export interface SelectionOptions {
	readonly toolTags: readonly string[] | undefined;
	readonly excludeTags: readonly string[];
}

/**
 * The lookup key both sides agree on.
 *
 * **Lower-cased, and that is not cosmetic.** `EmittedRoute.verb` is UPPERCASE (`"GET"`) while
 * `HttpOperation.verb` is lowercase (`"get"`) -- measured, on this package's own fixture. A
 * case-sensitive key misses every operation, and the failure is silent in the worst possible way:
 * the emitter selects nothing, reports `no-tools-selected`, and the message blames the tag
 * configuration. It was caught here only because a fixture asserted that an unnarrowed selection
 * selects SOMETHING.
 */
function keyOf(verb: string, path: string): string {
	return `${verb.toLowerCase()} ${path}`;
}

/** The `HttpOperation` behind each emitted route, keyed by verb and path. */
export function operationsById(service: HttpService): ReadonlyMap<string, HttpOperation> {
	const byVerbAndPath = new Map<string, HttpOperation>();
	for (const operation of service.operations) {
		byVerbAndPath.set(keyOf(operation.verb, operation.path), operation);
	}
	return byVerbAndPath;
}

/**
 * Look an operation up by verb and path, never by name.
 *
 * **Matching on operation NAME silently fails for every operation declared inside an `interface`**,
 * which is most of them in a real spec -- a defect this estate has already paid for once. The verb
 * and the path are what both the route and the document agree on.
 */
export function httpOperationFor(
	service: HttpService,
	route: EmittedRoute,
): HttpOperation | undefined {
	return operationsById(service).get(keyOf(route.verb, route.path));
}

export function selectTools(
	program: Program,
	service: HttpService,
	routes: readonly EmittedRoute[],
	options: SelectionOptions,
): Selection {
	const available = new Set<string>();
	const selected: string[] = [];

	for (const route of routes) {
		const operation = httpOperationFor(service, route);
		if (operation === undefined) continue;
		const tags = getAllTags(program, operation.operation) ?? [];
		for (const tag of tags) available.add(tag);

		if (options.excludeTags.some((tag) => tags.includes(tag))) continue;
		/**
		 * **Unset means every operation, and the alternative was rejected deliberately.** A magic tag
		 * name (`"tool"`, `"mcp"`) is a rule an author cannot see in the document and cannot discover,
		 * and it makes a correctly configured emitter produce nothing at all.
		 *
		 * **Union, not intersection.** OpenAPI tags are a flat set with no AND semantics, so "carries
		 * any of these" is the only reading the published document supports.
		 */
		if (options.toolTags !== undefined && !options.toolTags.some((tag) => tags.includes(tag))) {
			continue;
		}
		selected.push(route.operationId);
	}

	return { selected, available: [...available].toSorted() };
}
