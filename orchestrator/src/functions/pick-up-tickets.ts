import { config } from "../config.ts";
import { countRuns, getCursor, getFactoryState, recordPoll, recordRun, runsInFlight, setCursor, ticketRunInFlight } from "../db/index.ts";
import { applyLabels, comment, fetchOptedInTickets, ticketBlockers } from "../linear.ts";
import { blockedBy, cursorAfterPoll, decideRuns, linearComment, mayStartRuns, selectNewTickets } from "../logic.ts";
import { inngest, LINEAR_CHANGED, RUN_REQUESTED } from "../inngest.ts";
import { taskFromLabels } from "../tasks.ts";
import { LOOP_CAP, pickedUp, refused } from "../transitions.ts";

const CURSOR = "linear.updatedAt";

/**
 * Tickets with an `oscar-factory:<task>` label, assigned to Oscar, become runs. This is the only
 * place runs start: Oscar adding a label and one run handing off to the next (transitions.ts) both
 * arrive here as a label.
 * - It runs on LINEAR_CHANGED: Linear's webhook (src/linear-webhook.ts) sends one for every change
 *   to a ticket or comment, and `pickUpBackstop` every 10 minutes. A burst of changes, such as this
 *   function's own label writes, becomes one pass 5 seconds after the last. Each pass fetches every
 *   opted-in ticket changed since the cursor, whatever the event said, so a missed webhook costs at
 *   most the backstop's 10 minutes.
 * - Picking a ticket up adds in-progress and leaves the task label on, so Linear shows the stage; the
 *   run's end takes it off.
 * - A ticket with a run queued or working waits: the run's end changes its labels, which brings it back.
 * - At most `config.maxRuns` (FACTORY_MAX_RUNS) runs in flight across the factory: a pass fills the
 *   free slots, oldest ticket first. The rest keep their task label and wait in Linear, and the
 *   cursor stops short of the first of them, so the next pass fetches them again. A run's end changes
 *   its ticket's labels, and that change's webhook is the next pass. Inngest can't hold runs apart
 *   (see runTicket).
 * - Past the loop cap the task isn't started, and the ticket waits on Oscar.
 * - A ticket with an open blocker (a "blocked by" relation to a ticket neither done nor cancelled)
 *   isn't started, and the cursor passes it: the comment its last blocker's merge posts when it
 *   frees the ticket (the merge task's unblock step) brings it back.
 * - Only a machine with FACTORY_POLL=on, while the factory is running (`fac start` / `stop`),
 *   picks up at all. Otherwise it fetches nothing and leaves the cursor, so the next pass that may
 *   start runs fetches every ticket that changed meanwhile.
 * A ticket with an unknown or ambiguous factory label is skipped and reported in this function's
 * output, not on the ticket: a comment would bump `updatedAt` and bring it back every pass.
 */
export const pickUpTickets = inngest.createFunction(
  {
    id: "pick-up-tickets",
    triggers: [{ event: LINEAR_CHANGED }],
    debounce: { period: "5s", timeout: "1m" },
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    const mayStart = await step.run("may-start-runs", () => mayStartRuns(config.poll, getFactoryState().state));
    if (!mayStart) return { polled: false };

    const tickets = await step.run("fetch-tickets", async () => {
      const found = await fetchOptedInTickets(getCursor(CURSOR));
      recordPoll();
      return found;
    });
    const fresh = selectNewTickets(tickets, (t) => ticketRunInFlight(t.id));
    const choices = fresh.map((ticket) => ({ ticket, choice: taskFromLabels(ticket.labels) }));
    const skipped = choices.flatMap(({ ticket, choice }) =>
      !choice.ok && choice.reason ? [`${ticket.identifier}: ${choice.reason}`] : [],
    );
    const labelled = choices.flatMap(({ ticket, choice }) => (choice.ok ? [{ ticket, task: choice.task }] : []));

    // Blocked tickets wait for their blockers, reported here and not on the ticket.
    const blocked = await step.run("check-blockers", async () => {
      const open: Record<string, string[]> = {};
      for (const { ticket } of labelled) {
        const by = blockedBy(await ticketBlockers(ticket.id));
        if (by.length) open[ticket.id] = by;
      }
      return open;
    });
    for (const { ticket } of labelled) {
      const by = blocked[ticket.id];
      if (by) skipped.push(`${ticket.identifier}: blocked by ${by.join(", ")}.`);
    }
    const runnable = labelled.filter(({ ticket }) => !blocked[ticket.id]);

    // Oldest first: once the free slots are taken, every later ticket waits.
    const decided = await step.run("record-runs", () => {
      const free = config.maxRuns - runsInFlight();
      return decideRuns(runnable, free, (ticket, task) => countRuns(ticket.id, task) >= LOOP_CAP).map((d) => ({
        ...d,
        runId: d.outcome === "started" ? recordRun({ ticketId: d.ticket.id, ticketIdentifier: d.ticket.identifier, task: d.task, trigger: "linear-label" }) : null,
      }));
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
      await step.run(`pick-up-${ticket.identifier}`, () => applyLabels(ticket.id, pickedUp()));
      // The event id dedupes: one event per run even if this step replays.
      await step.sendEvent(`request-${ticket.identifier}`, {
        id: `run-${runId}`,
        name: RUN_REQUESTED,
        data: { runId, ticket, task },
      });
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

/**
 * Every 10 minutes, a pass whatever Linear sent: it catches a webhook Linear failed to deliver or
 * the orchestrator missed, such as one sent during a deploy.
 */
export const pickUpBackstop = inngest.createFunction(
  { id: "pick-up-backstop", triggers: [{ cron: "*/10 * * * *" }] },
  async ({ step }) => {
    await step.sendEvent("linear-changed", { name: LINEAR_CHANGED, data: { source: "backstop" } });
  },
);
