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

model ExportRequest {
  format: "csv" | "json";
}

model CatalogExport {
  url: string;
  titles: int32;
}

@error
model NotFound {
  @statusCode statusCode: 404;
  code: string;
  message: string;
}

/** Fetch one book. */
@route("/books/{bookId}")
@get
op getBook(@path bookId: string): Book | NotFound;

/** Export the whole catalogue. */
@route("/catalog/exports")
@post
op exportCatalog(@body request: ExportRequest): CatalogExport | NotFound;
