// The endpoint Linear's webhook calls, at /webhooks/linear on the orchestrator's HTTP server
// (server.ts). It checks Linear's signature and turns each change to a ticket or comment into a
// LINEAR_CHANGED event; pick-up-tickets (functions/pick-up-tickets.ts) does the rest. The payload
// says nothing the pickup relies on: each pass fetches what changed since its cursor, so a webhook
// only says when to look.
// A change to a sub-ticket also goes to any task watching its parent (`Task.watch`): the handler asks
// Linear for the parent's labels itself, so a change no task watches sends no event beyond
// LINEAR_CHANGED.
import type http from "node:http";
import { LinearWebhookClient } from "@linear/sdk/webhooks";
import { config } from "./config.ts";
import { inngest, LINEAR_CHANGED, SUB_TICKET_CHANGED } from "./inngest.ts";
import { ticketParent } from "./linear.ts";
import { TASKS, type TaskName } from "./tasks.ts";

/**
 * Changes to these can make a ticket runnable (its labels or assignee, or a comment, such as the
 * one the merge task posts when it frees a blocked ticket), or change a watched family.
 */
const WATCHED = ["Issue", "Comment"] as const;

/**
 * The Node handler for /webhooks/linear, or null when LINEAR_WEBHOOK_SECRET is unset. The SDK
 * rejects a bad signature, and a body more than a minute old, with 400. Linear retries a delivery
 * that fails, so a failed send of LINEAR_CHANGED answers 500.
 */
export function linearWebhookHandler(): ((req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>) | null {
  if (!config.linearWebhookSecret) return null;
  const handler = new LinearWebhookClient(config.linearWebhookSecret).createHandler();
  for (const type of WATCHED) {
    handler.on(type, async (payload) => {
      await inngest.send({ name: LINEAR_CHANGED, data: { source: "webhook", type: payload.type, action: payload.action } });
      // A watcher that can't be told never fails the delivery: LINEAR_CHANGED went out, and a retry
      // would only send it again. The family's next change tells it.
      await tellWatchers(changedSubTicket(payload)).catch((err) => console.warn(`Couldn't tell the watchers of a ${payload.type} change: ${(err as Error).message}`));
    });
  }
  return handler;
}

/**
 * The ticket a change may be a sub-ticket's change on: an issue that has a parent, or the ticket a
 * comment is on (the payload doesn't say whether that one has a parent). Null for anything else.
 */
export function changedSubTicket(payload: { type: string; data: unknown }): string | null {
  const data = (payload.data ?? {}) as { id?: string; parentId?: string | null; issueId?: string | null };
  if (payload.type === "Issue") return data.parentId && data.id ? data.id : null;
  if (payload.type === "Comment") return data.issueId ?? null;
  return null;
}

/** Each task that watches, with the flag it watches. */
const WATCHERS = (Object.keys(TASKS) as TaskName[]).flatMap((task) => {
  const flag = TASKS[task].watch?.flag;
  return flag ? [{ task, flag }] : [];
});

/** The tasks that watch tickets with any of these labels. */
export function watchersOf(labels: readonly string[]): TaskName[] {
  return WATCHERS.filter((w) => labels.includes(w.flag)).map((w) => w.task);
}

/** Sends SUB_TICKET_CHANGED to each task watching the ticket's parent. */
async function tellWatchers(ticketId: string | null): Promise<void> {
  if (!ticketId || !WATCHERS.length) return;
  const parent = await ticketParent(ticketId);
  if (!parent) return;
  for (const task of watchersOf(parent.labels)) {
    await inngest.send({ name: SUB_TICKET_CHANGED, data: { task, parent: { id: parent.id, identifier: parent.identifier } } });
  }
}
