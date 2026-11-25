import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "bunny-factory" });

export const RUN_REQUESTED = "factory/run.requested";

/** Cancels the run named by `data.runId`: `fac stop --now` sends it (scripts/factory.ts). */
export const RUN_STOP = "factory/run.stop";

/**
 * Something in Linear may have changed: Linear's webhook (linear-webhook.ts) and the backstop send
 * it, and pick-up-tickets starts runs from it. Its data says only where it came from.
 */
export const LINEAR_CHANGED = "factory/linear.changed";

/**
 * A sub-ticket of a ticket a task watches has changed (`Task.watch`): Linear's webhook sends it, and
 * functions/watch.ts calls the task. Its data names the task and the parent.
 */
export const SUB_TICKET_CHANGED = "factory/sub-ticket.changed";
