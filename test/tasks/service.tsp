import "@typespec/http";

using Http;

/**
 * A bookshop with one operation whose work can outlive a request (exporting the catalogue) and one
 * that always answers at once. Nothing here says which may run as an MCP task: that is configured
 * where the application wires the generated tools, which is what the suite proves.
 *
 * Both operations publish an `outputSchema` when nothing is configured, so the suite can show that
 * listing one withdraws it from that one only.
 */
@service(#{ title: "Bookshop" })
namespace Bookshop;

model Book {
  id: string;
  title: string;
}

model Export {
  format: "csv" | "json";
}

model Report {
  url: string;
  titles: int32;
}

@error
model NotFound {
  @statusCode statusCode: 404;
  code: string;
  message: string;
}

@route("/books")
interface Books {
  /** Fetch one book. */
  @route("/{bookId}") @get read(@path bookId: string): Book | NotFound;
}

@route("/catalog")
interface Catalog {
  /** Export the whole catalogue. */
  @route("/export") @post export(@body request: Export): Report | NotFound;
}
