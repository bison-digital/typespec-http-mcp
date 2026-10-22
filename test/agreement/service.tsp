import "@typespec/http";

using Http;

/**
 * A neutral reference service.
 *
 * **The vocabulary is deliberately closed and generic** -- widgets, items, pages.
 *
 * It carries one of everything the emitter has to reason about: a path parameter, a query parameter
 * that arrives as text, a header whose wire name differs from its TypeSpec name, a body with a
 * DEFAULTED property, a body the caller may leave out, a parameterless operation, a bodyless success,
 * two operations negotiating one route by `accept`, a cookie, a tagged interface, an operation
 * excluded by tag, and every method whose safety or idempotence the annotations derive from.
 *
 * **And one of every kind of response a handler returns**, because the result type is where the two
 * emitters are likeliest to part company: an exact failure, a failure RANGE with an optional header,
 * the `default` catch-all, a required header on a success, two success statuses with different
 * bodies, and a bodyless `204`. And one of every body that is not JSON: text, an image, a model a
 * handler serialises as XML, a file, and bytes no tool result can carry, which the tool surface
 * refuses and the HTTP surface serves.
 */
@service(#{ title: "Widgets" })
@useAuth(BearerAuth | Scoped)
namespace Widgets;

/**
 * Authentication is declared here so the two emitters' security derivations can be COMPARED.
 * `securityFor` is duplicated between them -- the library does not publish one -- so without a spec
 * that declares auth, any comparison of the two would be `[] === []` and would prove nothing.
 *
 * Two schemes, because they take different branches: a bearer scheme carries no scopes, and an
 * OAuth2 scheme carries them per flow.
 */
alias Scoped = OAuth2Auth<[{
  type: OAuth2FlowType.clientCredentials,
  tokenUrl: "https://example.test/token",
  scopes: ["widgets.read", "widgets.write"],
}]>;


model Widget {
  id: string;
  name: string;
  /** Defaulted, so a caller may omit it and a handler always receives it. */
  colour?: string = "grey";
}

/** A widget as a caller proposes it. */
model NewWidget {
  /** What the widget is called, unique among widgets. */
  name: string;

  colour?: string = "grey";
}

model WidgetPage {
  items: Widget[];
  total: int32;
}

/** The catch-all. It declares no status, so it is the document's `default`. */
@error
model Problem {
  code: string;
  message: string;
}

/** An exact failure. */
@error
model NotFound {
  @statusCode statusCode: 404;
  resource: string;
}

model Detail {
  message: string;
}

/** A failure RANGE with an optional header. Its codes exclude the exact 404 declared beside it. */
@error
model Throttled {
  @minValue(400)
  @maxValue(499)
  @statusCode
  statusCode: int32;

  @header("retry-after") retryAfter?: int32;
  @body detail: Detail;
}

/** A success carrying a required response header beside its body. */
model CountedPage {
  @statusCode statusCode: 200;
  @header("x-total-count") totalCount: int32;
  @body page: WidgetPage;
}

/** A second success status with a body of its own. */
model Created {
  @statusCode statusCode: 201;
  @body widget: Widget;
}

model Existing {
  @statusCode statusCode: 200;
  @body reference: WidgetReference;
}

model WidgetReference {
  id: string;
}

/** A success with no body at all. */
model Removed {
  @statusCode statusCode: 204;
}

model Note {
  text: string;
}

@tag("agent")
@route("/widgets")
interface WidgetTools {
  /** List widgets, newest first. */
  @get list(@query limit?: int32, @header("x-page-token") pageToken?: string): CountedPage | Problem;

  /**
   * Fetch one widget by its identifier.
   *
   * @param widgetId The identifier the widget was created with.
   */
  @route("/{widgetId}") @get read(@path widgetId: string): Widget | NotFound | Throttled | Problem;

  /** Create a widget, or answer with the one that already has its name. */
  @post create(@body body: NewWidget): Created | Existing | Problem;

  /** Replace a widget wholesale. */
  @route("/{widgetId}") @put replace(@path widgetId: string, @body body: NewWidget): Widget | Problem;

  /** A widget's picture, as PNG or any other image type the handler names. */
  @route("/{widgetId}/picture") @get picture(@path widgetId: string): {
    @header contentType: "image/png" | "image/*";
    @body body: bytes;
  } | NotFound;

  /** A widget's photo, as a file of one of two image types. */
  @route("/{widgetId}/photo") @get photo(@path widgetId: string): Http.File<"image/png" | "image/jpeg">;

  /** A widget's label, as plain text. */
  @route("/{widgetId}/label") @get label(@path widgetId: string): {
    @header contentType: "text/plain";
    @body body: string;
  } | NotFound;

  /** A widget as XML, which nothing serialises from the schema. */
  @route("/{widgetId}/xml") @get asXml(@path widgetId: string): {
    @header contentType: "application/xml";
    @body body: Widget;
  };

  /** Every widget, as one archive: bytes no image or audio block carries, so an embedded resource. */
  @route("/archive") @get archive(): {
    @header contentType: "application/octet-stream";
    @body body: bytes;
  };

  /** Restore every widget from an archive: bytes a tool argument cannot carry, so not a tool. */
  @route("/archive") @put restore(
    @header contentType: "application/octet-stream",
    @body body: bytes,
  ): {
    @statusCode statusCode: 204;
  };

  /** A widget as the handler packs it: a model under a media type that is not text, so its bytes. */
  @route("/{widgetId}/packed") @get packed(@path widgetId: string): {
    @header contentType: "application/octet-stream";
    @body body: Widget;
  };

  /** A widget's summary as text: one of two operations on one route, chosen by `accept`. */
  @sharedRoute
  @route("/{widgetId}/summary")
  @get
  summaryAsText(@path widgetId: string, @header accept: "text/plain"): {
    @header contentType: "text/plain";
    @body body: string;
  };

  /** A widget's summary as JSON: the other operation on the same route. */
  @sharedRoute
  @route("/{widgetId}/summary")
  @get
  summaryAsJson(@path widgetId: string, @header accept: "application/json"): Detail;

  /** A widget's display preferences for the caller's session, read from a cookie. */
  @route("/{widgetId}/preferences") @get preferences(@path widgetId: string, @cookie session: string): Detail;

  /** Mark a widget as seen, with a note or without one: the body is optional. */
  @route("/{widgetId}/seen") @post markSeen(@path widgetId: string, @body body?: Note): Widget | NotFound;

  /** Permanently remove a widget. */
  @route("/{widgetId}") @delete remove(@path widgetId: string): Removed | NotFound | Problem;
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
