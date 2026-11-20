import { createServer } from "inngest/node";
import { assertCheckoutCurrent } from "./checkout.ts";
import { config } from "./config.ts";
import { pollLinear } from "./functions/poll-linear.ts";
import { runCancelled } from "./functions/run-cancelled.ts";
import { runTicket } from "./functions/run-ticket.ts";
import { sweepRuns } from "./functions/sweep-runs.ts";
import { inngest } from "./inngest.ts";

await assertCheckoutCurrent();

const server = createServer({ client: inngest, functions: [pollLinear, runTicket, runCancelled, sweepRuns] });
server.listen(config.port, () => {
  console.log(`bunny-factory orchestrator on :${config.port}/api/inngest (data: ${config.dataDir})`);
});
