import "@typespec/http";

using Http;

/**
 * All three levels a `@tag` can sit at, in one spec.
 *
 * **The interface member is the whole point of this fixture.** A suite whose fixture carried only
 * namespace-level and operation-level tags would pass while the emitter read `getTags` and silently
 * dropped every operation declared inside a tagged interface.
 */
@service(#{ title: "Tagged" })
@tag("service-level")
namespace Tagged;

/** Tagged on the operation itself. */
@tag("agent")
@route("/things")
@get
op listThings(): { items: string[] };

/** Tagged nowhere but the namespace, so it is selected only when nothing narrows. */
@route("/things/{id}")
@delete
op removeThing(@path id: string): void;

/** Tagged on the INTERFACE. Its members carry the tag but do not declare it. */
@tag("agent")
@tag("admin")
interface Bulk {
  @route("/bulk")
  @post
  run(@body body: { count: int32 }): void;
}
