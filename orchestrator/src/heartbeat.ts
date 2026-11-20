// Inngest middleware on run-ticket: every call Inngest makes to the run's function (each step, each
// wake from a sleep) records a heartbeat on the run's row. sweep-runs (functions/sweep-runs.ts)
// closes a run in flight whose heartbeat has gone quiet: Inngest has lost it.
import { Middleware } from "inngest";
import { heartbeat } from "./db/index.ts";

export class RunHeartbeat extends Middleware.BaseMiddleware {
  readonly id = "run-heartbeat";

  override transformFunctionInput(arg: Middleware.TransformFunctionInputArgs): Middleware.TransformFunctionInputArgs {
    // The run's own event carries its id; the onFailure handler's event doesn't, and is skipped.
    const runId = (arg.ctx.event.data as { runId?: unknown } | undefined)?.runId;
    if (typeof runId === "string") heartbeat(runId);
    return arg;
  }
}
