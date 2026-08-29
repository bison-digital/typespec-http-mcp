import "@typespec/http";

using Http;

/** One operation per refusal, plus one per quality warning, plus a control that is clean. */
@service(#{ title: "Refusals" })
namespace Refusals;

model Item {
  id: string;
  name: string;
}

/** A raw binary body: bytes are not a JSON tool argument. */
@route("/upload")
@post
op uploadBytes(@body body: bytes): Item;

/** A multipart body: parts are not a JSON tool argument either. */
model UploadForm {
  name: HttpPart<string>;
  file: HttpPart<File>;
}

@route("/form")
@post
op uploadForm(@multipartBody body: UploadForm): Item;

/** Only a non-JSON media type is declared, so a tool has nothing it can send. */
@route("/xml")
@post
op sendXml(@header contentType: "application/xml", @body body: Item): Item;

/** JSON is declared beside a non-JSON type, so this is NOT refused. */
@route("/either")
@post
op sendEither(@header contentType: "application/json" | "application/xml", @body body: Item): Item;

/** A success with headers and no body: everything it produces lands where a model cannot read it. */
@route("/ping")
@post
op ping(): {
  @statusCode statusCode: 204;
  @header("x-request-id") requestId: string;
};

// Deliberately undescribed, so `tool-without-description` has something to fire on.
@route("/quiet")
@get
op quiet(): Item;

/** An ordinary JSON operation, so the arms below are not measuring an empty surface. */
@route("/items")
@get
op listItems(): Item[];
