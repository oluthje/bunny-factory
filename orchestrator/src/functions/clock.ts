// Clock triggers: one Inngest function per task that has a `clock` with a cron (see src/task.ts).
// When it fires, the task says which ticket to file, or why to skip; the ticket gets the task's
// label, and pick-up-tickets starts the run like any other. Its neighbours: pick-up-tickets.ts starts
// runs, run-ticket.ts is the run.
import { config } from "../config.ts";
import { getFactoryState } from "../db/index.ts";
import { inngest } from "../inngest.ts";
import { taskLabel } from "../labels.ts";
import { createTicket } from "../linear.ts";
import { mayStartRuns } from "../logic.ts";
import { TASKS, type TaskName } from "../tasks.ts";

/**
 * A clock files a ticket only on the machine that starts runs, and only while the factory is
 * running: a laptop, or a stopped factory, files none. A firing that fails after the ticket was
 * filed isn't retried, so one firing never files two.
 */
export const clocks = (Object.keys(TASKS) as TaskName[]).flatMap((task) => {
  const clock = TASKS[task].clock;
  if (!clock?.cron) return [];
  return [
    inngest.createFunction(
      { id: `clock-${task}`, triggers: [{ cron: `TZ=${config.timeZone} ${clock.cron}` }], concurrency: { limit: 1 }, retries: 0 },
      async ({ step }) => {
        const mayStart = await step.run("may-start-runs", () => mayStartRuns(config.poll, getFactoryState().state));
        if (!mayStart) return { filed: null, skipped: "This machine starts no runs now." };
        return step.run("file-ticket", async () => {
          const ticket = await clock.ticket(new Date());
          if ("skip" in ticket) return { filed: null, skipped: ticket.skip };
          const filed = await createTicket({ ...ticket, labels: [taskLabel(task)] });
          return { filed: filed.identifier, skipped: null };
        });
      },
    ),
  ];
});
