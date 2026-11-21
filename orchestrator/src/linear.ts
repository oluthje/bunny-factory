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

let team: Promise<string> | undefined;

/** The factory's team's id, cached. */
function teamId(): Promise<string> {
  return (team ??= (async () => {
    const id = (await linear().teams({ filter: { key: { eq: config.linearTeam } } })).nodes[0]?.id;
    if (!id) throw new Error(`Linear team ${config.linearTeam} not found`);
    return id;
  })());
}

export type NewTicket = { title: string; description: string; labels: string[] };
export type FiledTicket = { id: string; identifier: string; url: string };

/**
 * Files a ticket in the factory's team, assigned to the owner of LINEAR_API_KEY (Oscar), so the
 * poller picks it up when a label asks for a task. Not idempotent: call it in a step of its own.
 */
export async function createTicket(ticket: NewTicket): Promise<FiledTicket> {
  const [team, me, labelIds] = await Promise.all([teamId(), linear().viewer, Promise.all(ticket.labels.map(labelId))]);
  const payload = await linear().createIssue({ teamId: team, assigneeId: me.id, title: ticket.title, description: ticket.description, labelIds });
  const issue = await payload.issue;
  if (!payload.success || !issue) throw new Error(`Linear refused the ticket "${ticket.title}"`);
  return { id: issue.id, identifier: issue.identifier, url: issue.url };
}

/** Moves the ticket to the team's first completed state: nothing on it waits on anyone. */
export async function closeTicket(ticketId: string): Promise<void> {
  const states = await linear().workflowStates({ filter: { team: { key: { eq: config.linearTeam } }, type: { eq: "completed" } } });
  const done = [...states.nodes].sort((a, b) => a.position - b.position)[0];
  if (!done) throw new Error(`Linear team ${config.linearTeam} has no completed state`);
  await linear().updateIssue(ticketId, { stateId: done.id });
}

export type LabelledTicket = {
  id: string;
  identifier: string;
  title: string;
  url: string;
  labels: string[];
  /** `done` and `cancelled` are Linear's completed and canceled state types; anything else is open. */
  state: "open" | "done" | "cancelled";
};

/** Every ticket in the team with the label, whatever its state or assignee, oldest first. Up to 100. */
export async function ticketsWithLabel(label: string): Promise<LabelledTicket[]> {
  const data = await linear().client.request<
    { issues: { nodes: { id: string; identifier: string; title: string; url: string; state: { type: string }; labels: { nodes: { name: string }[] } }[] } },
    { team: string; label: string }
  >(
    `query($team: String!, $label: String!) {
      issues(first: 100, orderBy: createdAt, filter: { team: { key: { eq: $team } }, labels: { some: { name: { eq: $label } } } }) {
        nodes { id identifier title url state { type } labels { nodes { name } } }
      }
    }`,
    { team: config.linearTeam, label },
  );
  return data.issues.nodes
    .map((i) => ({
      id: i.id,
      identifier: i.identifier,
      title: i.title,
      url: i.url,
      labels: i.labels.nodes.map((l) => l.name),
      state: i.state.type === "completed" ? ("done" as const) : i.state.type === "canceled" ? ("cancelled" as const) : ("open" as const),
    }))
    .reverse();
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
