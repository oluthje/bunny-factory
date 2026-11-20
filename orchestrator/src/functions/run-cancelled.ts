import { closeIfOpen } from "../db/index.ts";
import { inngest } from "../inngest.ts";
import { applyLabels, comment } from "../linear.ts";
import { linearComment, sandboxName, type Ticket } from "../logic.ts";
import { deleteSandbox } from "../sandbox.ts";
import type { TaskName } from "../tasks.ts";
import { finished } from "../transitions.ts";

/**
 * A run stopped from the Inngest dashboard skips its own cleanup and `onFailure`, so this does it:
 * delete the sandbox, record it, say so on the ticket and move its labels on (to human-needed:
 * a cancelled run never hands off).
 * A run `fac stop --now` cancelled is already closed and requeued (task.ts, `requeue`): only
 * its sandbox is deleted again. `close` is its own step so a retry of `report` remembers whether
 * this function closed the run.
 */
export const runCancelled = inngest.createFunction(
  {
    id: "run-cancelled",
    triggers: [{ event: "inngest/function.cancelled", if: "event.data.function_id == 'bunny-factory-run-ticket'" }],
  },
  async ({ event, step }) => {
    const { runId, ticket, task } = event.data.event.data as { runId: string; ticket: Ticket; task: TaskName };
    await step.run("delete-sandbox", () => deleteSandbox(sandboxName(ticket.identifier, runId)));
    const closed = await step.run("close", () => closeIfOpen(runId, "cancelled"));
    if (!closed) return;
    await step.run("report", async () => {
      await comment(ticket.id, linearComment("The run was stopped before it finished.", runId));
      await applyLabels(ticket.id, finished(task, { status: "cancelled", next: "human" }));
    });
  },
);
