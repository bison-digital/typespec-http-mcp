import "@typespec/http";

using Http;

/**
 * The tools the official conformance suite's Tasks scenarios call, under the names and with the
 * arguments the suite fixes. The spec says nothing about tasks: the suite's server lists
 * every tool but `greet` in `deps.tasks` where it wires them.
 */
@service(#{ title: "Tasks conformance" })
namespace TasksConformance;

model Computation {
  seconds: int32;
  label?: string;
}

model Computed {
  label: string;
  seconds: int32;
}

@error
model JobFailed {
  @statusCode statusCode: 500;
  message: string;
}

/** Greet someone, at once. */
@route("/greet")
@get
op greet(@query name: string): {
  @header contentType: "text/plain";
  @body greeting: string;
};

/** Wait the given number of seconds, then answer. */
@route("/compute")
@post
op slow_compute(@body computation: Computation): Computed;

/** A job whose every run fails with a tool error. */
@route("/jobs/failing")
@post
op failing_job(): Computed | JobFailed;

/** A job whose every run fails below the tool, with a protocol error. */
@route("/jobs/protocol-error")
@post
op protocol_error_job(): Computed;

model Deletion {
  filename: string;
}

model Deleted {
  deleted: string;
}

model Answers {
  answered: int32;
}

/** Delete a file once the person confirms it. */
@route("/files/deletions")
@post
op confirm_delete(@body deletion: Deletion): Deleted;

/** Ask two questions at once, then answer. */
@route("/questions")
@post
op multi_input(): Answers;
