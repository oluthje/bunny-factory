// The endpoint Linear's webhook calls, at /webhooks/linear on the orchestrator's HTTP server
// (server.ts). It checks Linear's signature and turns each change to a ticket or comment into a
// LINEAR_CHANGED event; pick-up-tickets (functions/pick-up-tickets.ts) does the rest. The payload
// says nothing the pickup relies on: each pass fetches what changed since its cursor, so a webhook
// only says when to look.
import type http from "node:http";
import { LinearWebhookClient } from "@linear/sdk/webhooks";
import { config } from "./config.ts";
import { inngest, LINEAR_CHANGED } from "./inngest.ts";

/**
 * Changes to these can make a ticket runnable: its labels or assignee, or a comment, such as the
 * one the merge task posts when it frees a blocked ticket.
 */
const WATCHED = ["Issue", "Comment"] as const;

/**
 * The Node handler for /webhooks/linear, or null when LINEAR_WEBHOOK_SECRET is unset. The SDK
 * rejects a bad signature, and a body more than a minute old, with 400. Linear retries a delivery
 * that fails, so a failed send to Inngest answers 500.
 */
export function linearWebhookHandler(): ((req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>) | null {
  if (!config.linearWebhookSecret) return null;
  const handler = new LinearWebhookClient(config.linearWebhookSecret).createHandler();
  for (const type of WATCHED) {
    handler.on(type, async (payload) => {
      await inngest.send({ name: LINEAR_CHANGED, data: { source: "webhook", type: payload.type, action: payload.action } });
    });
  }
  return handler;
}
