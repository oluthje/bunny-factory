// Watches: when a sub-ticket of a ticket with a task's flag label changes, Linear's webhook
// (src/linear-webhook.ts) sends SUB_TICKET_CHANGED, and this calls the task's `watch.changed` with the
// parent (see `Watch` in src/task.ts). A burst of changes, such as a run posting its comments and
// then moving its labels, becomes one call per task and parent, a minute after the last.
import { inngest, SUB_TICKET_CHANGED } from "../inngest.ts";
import { TASKS, type TaskName } from "../tasks.ts";

import type { ParentTicket } from "../task.ts";

type SubTicketChanged = { task: TaskName; parent: ParentTicket };

export const watchSubTickets = inngest.createFunction(
  {
    id: "watch-sub-tickets",
    triggers: [{ event: SUB_TICKET_CHANGED }],
    // Per task and parent: two tasks watching one parent each get their call.
    debounce: { key: 'event.data.task + "-" + event.data.parent.id', period: "1m", timeout: "10m" },
    concurrency: { key: 'event.data.task + "-" + event.data.parent.id', limit: 1 },
  },
  async ({ event, step }) => {
    const { task, parent } = event.data as SubTicketChanged;
    const watch = TASKS[task]?.watch;
    if (!watch) return { skipped: `${task} watches nothing` };
    return watch.changed({ step, parent });
  },
);
