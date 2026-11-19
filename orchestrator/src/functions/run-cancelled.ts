import { updateRun } from "../db/index.ts";
import { inngest } from "../inngest.ts";
import { comment, setInProgress } from "../linear.ts";
import { linearComment, sandboxName, type Ticket } from "../logic.ts";
import { deleteSandbox } from "../sandbox.ts";

/**
 * A run stopped from the Inngest dashboard skips its own cleanup and `onFailure`, so this does it:
 * delete the sandbox, clear the in-progress label and say so on the ticket.
 */
export const runCancelled = inngest.createFunction(
  {
    id: "run-cancelled",
    triggers: [{ event: "inngest/function.cancelled", if: "event.data.function_id == 'bunny-factory-run-ticket'" }],
  },
  async ({ event, step }) => {
    const { runId, ticket } = event.data.event.data as { runId: string; ticket: Ticket };
    await step.run("delete-sandbox", () => deleteSandbox(sandboxName(ticket.identifier, runId)));
    await step.run("report", async () => {
      updateRun(runId, { status: "cancelled", finishedAt: new Date().toISOString() });
      await setInProgress(ticket.id, false);
      await comment(ticket.id, linearComment("The run was stopped before it finished.", runId));
    });
  },
);
