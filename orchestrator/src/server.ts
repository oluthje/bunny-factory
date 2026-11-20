// The orchestrator's HTTP server: Inngest calls the functions at /api/inngest, and Fly's health
// check calls /health. Inngest's own endpoint answers an unsigned GET with 401 in production, so it
// can't be the health check.
import http from "node:http";
import { serve } from "inngest/node";
import { assertCheckoutCurrent } from "./checkout.ts";
import { config } from "./config.ts";
import { pollLinear } from "./functions/poll-linear.ts";
import { runCancelled } from "./functions/run-cancelled.ts";
import { runTicket } from "./functions/run-ticket.ts";
import { sweepRuns } from "./functions/sweep-runs.ts";
import { inngest } from "./inngest.ts";

await assertCheckoutCurrent();

const functions = serve({ client: inngest, functions: [pollLinear, runTicket, runCancelled, sweepRuns] });

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  if (pathname === "/api/inngest") return functions(req, res);
  if (pathname === "/health") return res.writeHead(200, { "content-type": "text/plain" }).end("ok\n");
  res.writeHead(404).end();
});
server.listen(config.port, () => {
  console.log(`bunny-factory orchestrator on :${config.port}/api/inngest (data: ${config.dataDir})`);
});
