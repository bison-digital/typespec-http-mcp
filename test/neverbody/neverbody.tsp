import "@typespec/http";

using Http;

/**
 * A request body declared `never`, which openapi3 publishes as any JSON value. See
 * `neverbody.test.ts`.
 */
@service(#{ title: "Never body" })
namespace NeverBody;

model Thing {
  id: string;
}

@route("/never")
@post
op neverBody(@body body: never): Thing;
