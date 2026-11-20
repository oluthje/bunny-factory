import { LinearClient } from "@linear/sdk";
import { config } from "./config.ts";
import type { TicketComment } from "./comments.ts";
import type { Ticket } from "./logic.ts";
import { LABEL_PREFIX } from "./labels.ts";
import type { LabelChange } from "./transitions.ts";

let client: LinearClient | undefined;
const linear = () => (client ??= new LinearClient({ apiKey: config.linearApiKey() }));

/**
 * Tickets that opt in: an `oscar-factory:<task>` label, assigned to the owner of LINEAR_API_KEY
 * (Oscar), updated after the cursor. Oldest first, so the cursor advances in order.
 */
export async function fetchOptedInTickets(updatedAfter: string | null): Promise<Ticket[]> {
  const page = await linear().issues({
    first: 50,
    filter: {
      team: { key: { eq: config.linearTeam } },
      labels: { some: { name: { startsWith: LABEL_PREFIX } } },
      assignee: { isMe: { eq: true } },
      ...(updatedAfter ? { updatedAt: { gt: updatedAfter } } : {}),
    },
  });
  const tickets = await Promise.all(
    page.nodes.map(async (i) => ({
      id: i.id,
      identifier: i.identifier,
      title: i.title,
      description: i.description ?? "",
      url: i.url,
      branchName: i.branchName,
      labels: (await i.labels()).nodes.map((l) => l.name),
      updatedAt: i.updatedAt.toISOString(),
    })),
  );
  return tickets.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

export async function comment(ticketId: string, body: string): Promise<void> {
  await linear().createComment({ issueId: ticketId, body });
}

const labelIds = new Map<string, string>();

/** A team label's id by name, cached. Fails if the label doesn't exist in the team. */
async function labelId(name: string): Promise<string> {
  const cached = labelIds.get(name);
  if (cached) return cached;
  const page = await linear().issueLabels({
    filter: { name: { eq: name }, team: { key: { eq: config.linearTeam } } },
  });
  const id = page.nodes[0]?.id;
  if (!id) throw new Error(`Linear label ${name} not found in team ${config.linearTeam}`);
  labelIds.set(name, id);
  return id;
}

/**
 * Applies a transition from transitions.ts in one write, leaving the ticket's other labels alone.
 * Idempotent: adds only what's missing and removes only what's there.
 */
export async function applyLabels(ticketId: string, change: LabelChange): Promise<void> {
  const [add, remove] = await Promise.all([Promise.all(change.add.map(labelId)), Promise.all(change.remove.map(labelId))]);
  const has = new Set((await (await linear().issue(ticketId)).labels()).nodes.map((l) => l.id));
  const addedLabelIds = add.filter((id) => !has.has(id));
  const removedLabelIds = remove.filter((id) => has.has(id));
  if (addedLabelIds.length || removedLabelIds.length) await linear().updateIssue(ticketId, { addedLabelIds, removedLabelIds });
}

/** The ticket's comments, oldest first, each marked if the API key's owner (Oscar) wrote it. Up to 100. */
export async function ticketComments(ticketId: string): Promise<TicketComment[]> {
  const data = await linear().client.request<
    { issue: { comments: { nodes: { body: string; createdAt: string; user: { isMe: boolean } | null }[] } } },
    { id: string }
  >(
    `query($id: String!) { issue(id: $id) { comments(first: 100) { nodes { body createdAt user { isMe } } } } }`,
    { id: ticketId },
  );
  return data.issue.comments.nodes
    .map((c) => ({ body: c.body, createdAt: c.createdAt, isMe: c.user?.isMe ?? false }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Uploads a file to Linear's storage and returns its asset URL (opens for workspace members). */
export async function uploadFile(data: Buffer, filename: string, contentType: string): Promise<string> {
  const payload = await linear().fileUpload(contentType, filename, data.length);
  const target = payload.uploadFile;
  if (!payload.success || !target) throw new Error(`Linear refused the upload of ${filename}`);
  const headers: Record<string, string> = { "Content-Type": contentType, "Cache-Control": "public, max-age=31536000" };
  for (const h of target.headers) headers[h.key] = h.value;
  const res = await fetch(target.uploadUrl, { method: "PUT", headers, body: new Uint8Array(data) });
  if (!res.ok) throw new Error(`upload of ${filename} failed: ${res.status} ${await res.text()}`);
  return target.assetUrl;
}

/** The ticket's labels now, by name: the poller's copy may be minutes old by the time a run ends. */
export async function ticketLabels(ticketId: string): Promise<string[]> {
  return (await (await linear().issue(ticketId)).labels()).nodes.map((l) => l.name);
}
