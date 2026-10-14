import "@typespec/http";

using Http;

/**
 * A service whose operations demand DIFFERENT authorisation, so a partial grant yields a partial
 * tool list.
 *
 * **This is why the socket suite does not reuse `test/agreement/service.tsp`.** That spec declares
 * `@useAuth` once, on the namespace, so every operation carries the same requirement and only two
 * lists are reachable: all of them, or none. Two lists cannot distinguish "the surface is filtered
 * per caller" from "the surface is on or off", which is the claim this suite exists to make.
 *
 * Three grants, three genuinely different lists:
 *
 * - read-only  -> the two read tools, plus the public one
 * - read+write -> every tool
 * - no grant   -> the public one and the optional one, because an anonymous alternative is the empty
 *   requirement `{}`, which every caller satisfies
 *
 * Three operations echo the `authentication` the generated call passed to `deps.context`, one per
 * value, so a server passing the wrong one is caught by a real client rather than by reading output.
 *
 * The vocabulary is deliberately closed and generic; `provenance.test.ts` grades this file for a
 * private domain noun reaching a published package.
 */
@service(#{ title: "Widgets" })
@useAuth(Read | Write)
namespace Widgets;

alias Read = OAuth2Auth<[{
  type: OAuth2FlowType.clientCredentials,
  tokenUrl: "https://example.test/token",
  scopes: ["widgets.read"],
}]>;

alias Write = OAuth2Auth<[{
  type: OAuth2FlowType.clientCredentials,
  tokenUrl: "https://example.test/token",
  scopes: ["widgets.write"],
}]>;

model Widget {
  id: string;
  name: string;
  colour?: string = "grey";
}

model NewWidget {
  name: string;
  colour?: string = "grey";
}

model WidgetPage {
  items: Widget[];
  total: int32;
  /** What `deps.context` was told this call demands. */
  authentication: string;
}

@error
model Problem {
  code: string;
  message: string;
}

@route("/widgets")
interface WidgetTools {
  /** List widgets, newest first. */
  @useAuth(Read)
  @get list(@query limit?: int32): WidgetPage | Problem;

  /**
   * Fetch one widget by its identifier.
   *
   * @param widgetId The identifier the widget was created with.
   */
  @useAuth(Read)
  @route("/{widgetId}") @get read(@path widgetId: string): Widget | Problem;

  /** Create a widget. */
  @useAuth(Write)
  @post create(@body body: NewWidget): Widget | Problem;

  /** Permanently remove a widget. */
  @useAuth(Write)
  @route("/{widgetId}") @delete remove(@path widgetId: string): void | Problem;
}

/** Public, so `permits` receives `[{}]` and every caller sees it -- including one with no grant. */
@useAuth(NoAuth)
@route("/health")
@get
op health(): { status: string; authentication: string };

/**
 * Who is asking. Anonymous callers are admitted and a read grant is recognised, so `permits` receives
 * `[{}, { OAuth2Auth: ["widgets.read"] }]` and `deps.context` is told `"optional"`.
 */
@useAuth(NoAuth | Read)
@route("/whoami")
@get
op whoami(): { caller: string; authentication: string };
