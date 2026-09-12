import "@typespec/http";

using Http;

/**
 * Tool descriptions carrying text that emitted source cannot hold verbatim.
 *
 * **Here a description is not decoration.** It is serialised into the tool manifest a model reads
 * when choosing a tool, and it is also rendered as a JSDoc comment on the `Operations` method. The
 * runtime copy went through `JSON.stringify` and was always safe; the comment three lines above it
 * did not, so a description containing a comment terminator closed the comment early and the
 * remainder became code.
 */
@service(#{ title: "Summary text" })
namespace SummaryText;

model Item {
  id: string;
}

@route("/terminator")
@get
@doc("Reads an item. Returns a */ b, which used to close the comment.")
op readTerminator(): Item;

@route("/multiline")
@get
@doc("""
  Reads an item.
  The second line used to sit outside the comment.
  """)
op readMultiline(): Item;

@route("/plain")
@get
@doc("Reads an item, plainly, so the arms below compare something.")
op readPlain(): Item;
