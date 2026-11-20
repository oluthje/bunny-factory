import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "bunny-factory" });

export const RUN_REQUESTED = "factory/run.requested";

/** Cancels the run named by `data.runId`: `factory stop --now` sends it (scripts/factory.ts). */
export const RUN_STOP = "factory/run.stop";
