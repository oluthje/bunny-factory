import { anyRunInFlight, countRuns, getCursor, recordRun, setCursor, ticketRunInFlight } from "../db/index.ts";
import { applyLabels, comment, fetchOptedInTickets } from "../linear.ts";
import { cursorAfterPoll, linearComment, selectNewTickets } from "../logic.ts";
import { inngest, RUN_REQUESTED } from "../inngest.ts";
import { TASKS, taskFromLabels, taskLabel } from "../tasks.ts";
import { LOOP_CAP, pickedUp, refused } from "../transitions.ts";

const CURSOR = "linear.updatedAt";

/**
 * Every minute: tickets with an `oscar-factory:<task>` label, assigned to Oscar, become runs. This is
 * the only place runs start: Oscar adding a label and one run handing off to the next (transitions.ts)
 * both arrive here as a label.
 * - Picking a ticket up takes its task label off, so adding it again asks for another run.
 * - A ticket with a run queued or working waits: the run's end changes its labels, which brings it back.
 * - One run at a time across the factory: a poll starts a run only when none is in flight, oldest
 *   ticket first. The rest keep their task label and wait in Linear, and the cursor stops short of
 *   them, so a later poll fetches them again. Inngest can't hold runs apart (see runTicket).
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

    // Oldest first: once the one slot is taken, every later ticket waits.
    const decided = await step.run("record-runs", () => {
      let slotFree = !anyRunInFlight();
      return runnable.map(({ ticket, task }) => {
        if (countRuns(ticket.id, task) >= LOOP_CAP) return { ticket, task, outcome: "capped" as const, runId: null };
        if (!slotFree) return { ticket, task, outcome: "waiting" as const, runId: null };
        slotFree = false;
        const runId = recordRun({ ticketId: ticket.id, ticketIdentifier: ticket.identifier, task, trigger: "linear-label" });
        return { ticket, task, outcome: "started" as const, runId };
      });
    });

    for (const { ticket, task, outcome, runId } of decided) {
      if (outcome === "waiting") continue;
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
            `Picked up \`${taskLabel(task)}\`. I'll comment again with ${TASKS[task].delivers} or the failure.`,
            runId,
          ),
        ),
      );
    }

    await step.run("advance-cursor", () => {
      const waiting = decided.find((d) => d.outcome === "waiting")?.ticket ?? null;
      const next = cursorAfterPoll(getCursor(CURSOR), tickets, waiting);
      if (next) setCursor(CURSOR, next);
      return next;
    });
    const named = (outcome: string) => decided.filter((d) => d.outcome === outcome).map((d) => d.ticket.identifier);
    return { seen: tickets.length, started: named("started"), waiting: named("waiting"), capped: named("capped"), skipped };
  },
);
