import "@typespec/http";

using Http;

/**
 * A neutral reference service.
 *
 * **The vocabulary is deliberately closed and generic** -- widgets, items, pages. A fixture naming a
 * real business noun is how a private domain reaches a published package, and `provenance.test.ts`
 * grades this file for exactly that.
 *
 * It carries one of everything the emitter has to reason about: a path parameter, a query parameter
 * that arrives as text, a header whose wire name differs from its TypeSpec name, a body with a
 * DEFAULTED property, a parameterless operation, a bodyless success, a tagged interface, an
 * operation excluded by tag, and every method whose safety or idempotence the annotations derive
 * from.
 */
@service(#{ title: "Widgets" })
namespace Widgets;

model Widget {
  id: string;
  name: string;
  /** Defaulted, so a caller may omit it and a handler always receives it. */
  colour: string = "grey";
}

model NewWidget {
  name: string;
  colour: string = "grey";
}

model WidgetPage {
  items: Widget[];
  total: int32;
}

@error
model Problem {
  code: string;
  message: string;
}

@tag("agent")
@route("/widgets")
interface WidgetTools {
  /** List widgets, newest first. */
  @get list(@query limit?: int32, @header("x-page-token") pageToken?: string): WidgetPage | Problem;

  /** Fetch one widget by its identifier. */
  @route("/{widgetId}") @get read(@path widgetId: string): Widget | Problem;

  /** Create a widget. */
  @post create(@body body: NewWidget): Widget | Problem;

  /** Replace a widget wholesale. */
  @route("/{widgetId}") @put replace(@path widgetId: string, @body body: NewWidget): Widget | Problem;

  /** Permanently remove a widget. */
  @route("/{widgetId}") @delete remove(@path widgetId: string): void | Problem;
}

/** Selected by no tag, so it is excluded whenever `tool-tags` is set. */
@route("/internal/reindex")
@post
op reindex(): void;

/** Parameterless, and tagged, so the empty-input case is exercised. */
@tag("agent")
@route("/health")
@get
op health(): { status: string };
