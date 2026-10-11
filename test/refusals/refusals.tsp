import "@typespec/http";
import "@typespec/sse";
import "@typespec/events";

using Http;
using Events;
using SSE;

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

/** A model under a media type that is not text is bytes, which a tool argument cannot carry. */
@route("/blob")
@put
op uploadBlob(@header contentType: "application/octet-stream", @body body: Item): Item;

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

/** Raw bytes no image or audio block carries: a tool, answering an embedded resource. */
@route("/download")
@get
op downloadBytes(): {
  @header contentType: "application/octet-stream";
  @body body: bytes;
};

/** A model under a media type that is not text: the bytes the handler answers, embedded. */
@route("/download-blob")
@get
op downloadBlob(): {
  @header contentType: "application/octet-stream";
  @body body: Item;
};

/** Raw bytes offered as an image AND as an octet stream: a tool, answering whichever is sent. */
@route("/download-either")
@get
op downloadEither(): {
  @header contentType: "image/png" | "application/octet-stream";
  @body body: bytes;
};

@events
union ItemEvents {
  @Events.contentType("application/json")
  Item,
}

/** A stream of events: a tool result is one message. */
@route("/events")
@get
op itemEvents(): SSEStream<ItemEvents>;

/** Bytes as an image: answered as an MCP image block, so NOT refused. */
@route("/thumbnail")
@get
op thumbnail(): {
  @header contentType: "image/png";
  @body body: bytes;
};

/** A string as text: validated and answered as a text block, so neither refused nor warned about. */
@route("/note")
@get
op note(): {
  @header contentType: "text/plain";
  @body body: string;
};

/** A model as XML: nothing serialises it, so the handler supplies the text, unvalidated. */
@route("/item-xml")
@get
op itemXml(): {
  @header contentType: "application/xml";
  @body body: Item;
};

/** An ordinary JSON operation, so the arms below are not measuring an empty surface. */
@route("/items")
@get
op listItems(): Item[];
