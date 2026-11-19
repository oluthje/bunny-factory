import { getCursor, recordRun, setCursor, ticketHasRun } from "../db/index.ts";
import { comment, fetchOptedInTickets } from "../linear.ts";
import { advanceCursor, linearComment, selectNewTickets } from "../logic.ts";
import { inngest, RUN_REQUESTED } from "../inngest.ts";
import { taskFromLabels } from "../tasks.ts";

const CURSOR = "linear.updatedAt";

/**
 * Every minute: tickets with an `oscar-factory:<task>` label, assigned to Oscar, become runs:
 * one per ticket and task, so swapping `implement` for `review` starts a review.
 * A ticket with an unknown or ambiguous factory label is skipped and reported in this function's
 * output, not on the ticket: a comment would bump `updatedAt` and bring it back every poll.
 */
export const pollLinear = inngest.createFunction(
  { id: "poll-linear", triggers: [{ cron: "* * * * *" }], concurrency: { limit: 1 } },
  async ({ step }) => {
    const tickets = await step.run("fetch-tickets", () => fetchOptedInTickets(getCursor(CURSOR)));
    const fresh = selectNewTickets(tickets, (t) => {
      const choice = taskFromLabels(t.labels);
      return choice.ok && ticketHasRun(t.id, choice.task);
    });
    const choices = fresh.map((ticket) => ({ ticket, choice: taskFromLabels(ticket.labels) }));
    const skipped = choices.flatMap(({ ticket, choice }) =>
      !choice.ok && choice.reason ? [`${ticket.identifier}: ${choice.reason}`] : [],
    );
    const runnable = choices.flatMap(({ ticket, choice }) => (choice.ok ? [{ ticket, task: choice.task }] : []));

    const started = await step.run("record-runs", () =>
      runnable.map(({ ticket, task }) => ({
        runId: recordRun({ ticketId: ticket.id, ticketIdentifier: ticket.identifier, task, trigger: "linear-label" }),
        ticket,
        task,
      })),
    );

    for (const { runId, ticket, task } of started) {
      // The event id dedupes: one run per ticket and task even if this step replays.
      await step.sendEvent(`request-${ticket.identifier}`, {
        id: `run-${ticket.id}-${task}`,
        name: RUN_REQUESTED,
        data: { runId, ticket, task },
      });
      await step.run(`ack-${ticket.identifier}`, () =>
        comment(
          ticket.id,
          linearComment(
            `Picked up for \`${task}\`. I'll comment again with the ${task === "review" ? "review" : "PR"} or the failure.`,
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
    return { seen: tickets.length, started: started.map((s) => s.ticket.identifier), skipped };
  },
);
