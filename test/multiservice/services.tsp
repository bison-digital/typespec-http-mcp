import "@typespec/http";

using Http;

/**
 * Two services in one program, which the conformance corpus does not contain.
 *
 * `@typespec/http-specs` declares no scenario with more than one `@service`, so every arm in this
 * package has only ever seen a single-service program. The emitter loops per service and writes
 * `mcp.gen.ts` into each one's output directory, and `emitFile` has no duplicate-path detection --
 * measured, and recorded in `src/emitter.ts`. If two services resolved to one directory the second
 * would overwrite the first, exit 0, no diagnostic, and a whole tool surface would be gone.
 */
@service(#{ title: "Widgets" })
namespace Widgets {
  model Widget {
    id: string;
    name: string;
  }

  @route("/widgets")
  @get
  op listWidgets(): Widget[];

  @route("/widgets/{widgetId}")
  @get
  op readWidget(@path widgetId: string): Widget;
}

@service(#{ title: "Gadgets" })
namespace Gadgets {
  model Gadget {
    id: string;
    weight: int32;
  }

  @route("/gadgets")
  @get
  op listGadgets(): Gadget[];
}
