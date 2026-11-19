import { countRuns, getCursor, recordRun, setCursor, ticketRunInFlight } from "../db/index.ts";
import { applyLabels, comment, fetchOptedInTickets } from "../linear.ts";
import { advanceCursor, linearComment, selectNewTickets } from "../logic.ts";
import { inngest, RUN_REQUESTED } from "../inngest.ts";
import { taskFromLabels, taskLabel } from "../tasks.ts";
import { LOOP_CAP, pickedUp, refused } from "../transitions.ts";

const CURSOR = "linear.updatedAt";

/**
 * Every minute: tickets with an `oscar-factory:<task>` label, assigned to Oscar, become runs. This is
 * the only place runs start: Oscar adding a label and one run handing off to the next (transitions.ts)
 * both arrive here as a label.
 * - Picking a ticket up takes its task label off, so adding it again asks for another run.
 * - A ticket with a run queued or working waits: the run's end changes its labels, which brings it back.
 * - Past the loop cap the task isn't started, and the ticket waits on Oscar.
 * A ticket with an unknown or ambiguous factory label is skipped and reported in this function's
 * output, not on the ticket: a comment would bump `updatedAt` and bring it back every poll.
 */
export const pollLinear = inngest.createFunction(
  { id: "poll-linear", triggers: [{ cron: "* * * * *" }], concurrency: { limit: 1 } },
  async ({ step }) => {
    const tickets = await step.run("fetch-tickets", () => fetchOptedInTickets(getCursor(CURSOR)));
    const fresh = selectNewTickets(tickets, (t) => ticketRunInFlight(t.id));
    const choices = fresh.map((ticket) => ({ ticket, choice: taskFromLabels(ticket.labels) }));
    const skipped = choices.flatMap(({ ticket, choice }) =>
      !choice.ok && choice.reason ? [`${ticket.identifier}: ${choice.reason}`] : [],
    );
    const runnable = choices.flatMap(({ ticket, choice }) => (choice.ok ? [{ ticket, task: choice.task }] : []));

    const decided = await step.run("record-runs", () =>
      runnable.map(({ ticket, task }) =>
        countRuns(ticket.id, task) >= LOOP_CAP
          ? { ticket, task, runId: null }
          : {
              ticket,
              task,
              runId: recordRun({ ticketId: ticket.id, ticketIdentifier: ticket.identifier, task, trigger: "linear-label" }),
            },
      ),
    );

    for (const { ticket, task, runId } of decided) {
      if (runId === null) {
        await step.run(`refuse-${ticket.identifier}`, async () => {
          await comment(
            ticket.id,
            linearComment(
              `Not starting \`${task}\`: the ticket has had ${LOOP_CAP} runs of it, the loop cap. Take it from here, or raise the cap.`,
              null,
            ),
          );
          await applyLabels(ticket.id, refused(task));
        });
        continue;
      }
      await step.run(`pick-up-${ticket.identifier}`, () => applyLabels(ticket.id, pickedUp(task)));
      // The event id dedupes: one event per run even if this step replays.
      await step.sendEvent(`request-${ticket.identifier}`, {
        id: `run-${runId}`,
        name: RUN_REQUESTED,
        data: { runId, ticket, task },
      });
      await step.run(`ack-${ticket.identifier}`, () =>
        comment(
          ticket.id,
          linearComment(
            `Picked up \`${taskLabel(task)}\`. I'll comment again with the ${task === "review" ? "review" : "PR"} or the failure.`,
            runId,
          ),
        ),
      );
    }

    await step.run("advance-cursor", () => {
      const next = advanceCursor(getCursor(CURSOR), tickets);
      if (next) setCursor(CURSOR, next);
      return next;
    });
    const started = decided.filter((d) => d.runId !== null).map((d) => d.ticket.identifier);
    const capped = decided.filter((d) => d.runId === null).map((d) => d.ticket.identifier);
    return { seen: tickets.length, started, capped, skipped };
  },
);
