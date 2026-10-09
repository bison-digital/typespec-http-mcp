import "@typespec/http";

using Http;

/**
 * Operations sharing a route, each told apart only by its `accept`.
 *
 * **Verb and path do not identify an operation here**, and this emitter looked operations up by
 * them: every member of a route then read ONE member's doc comment, tags and diagnostic target.
 * Each member below differs from its neighbour in exactly those, so a lookup answering either the
 * first or the last member of a route fails.
 */
@service(#{ title: "Shared" })
namespace Shared;

model Report {
  text: string;
}

/** The report, as plain text. */
@tag("agent")
@sharedRoute
@route("/report")
@get
op reportAsText(@header accept: "text/plain"): {
  @header contentType: "text/plain";
  @body body: string;
};

/** The report, as JSON. */
@sharedRoute
@route("/report")
@get
op reportAsJson(@header accept: "application/json"): Report;

// Neither is documented, so each raises its own `tool-without-description`, against itself.
@sharedRoute
@route("/status")
@get
op statusAsText(@header accept: "text/plain"): {
  @header contentType: "text/plain";
  @body body: string;
};

@sharedRoute
@route("/status")
@get
op statusAsJson(@header accept: "application/json"): Report;
