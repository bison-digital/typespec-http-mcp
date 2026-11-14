import "@typespec/http";

using Http;

/**
 * The tools the official conformance suite's Tasks scenarios call, under the names and with the
 * arguments the suite fixes. The spec says nothing about tasks: the suite's server lists
 * every tool but `greet` in `deps.tasks` where it wires them.
 */
@service(#{ title: "Jobs" })
namespace Jobs;

model Job {
  seconds: int32;
  label?: string;
}

model Output {
  label: string;
  seconds: int32;
}

@error
model Problem {
  @statusCode statusCode: 500;
  message: string;
}

model File {
  filename: string;
}

model Done {
  filename: string;
}

model Answers {
  count: int32;
}

/** Greet someone, at once. */
@route("/hello")
@get
op greet(@query name: string): {
  @header contentType: "text/plain";
  @body text: string;
};

/** Wait the given number of seconds, then answer. */
@route("/jobs/start")
@post
op slow_compute(@body job: Job): Output;

/** A job whose every run fails with a tool error. */
@route("/jobs/failure")
@post
op failing_job(): Output | Problem;

/** A job whose every run fails below the tool, with a protocol error. */
@route("/jobs/error")
@post
op protocol_error_job(): Output;

/** Remove a file once the person confirms it. */
@route("/files/remove")
@post
op confirm_delete(@body file: File): Done;

/** Ask two questions at once, then answer. */
@route("/answers")
@post
op multi_input(): Answers;
