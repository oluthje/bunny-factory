import { LinearClient } from "@linear/sdk";
import { config } from "./config.ts";
import type { TicketComment } from "./comments.ts";
import type { Linked, Ticket } from "./logic.ts";
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

/** `parentId` files it as a sub-ticket of that ticket. */
export type NewTicket = { title: string; description: string; labels: string[]; parentId?: string };
export type FiledTicket = { id: string; identifier: string; url: string };

/**
 * Files a ticket in the factory's team, assigned to the owner of LINEAR_API_KEY (Oscar), so the
 * pick-up-tickets picks it up when a label asks for a task. Not idempotent: call it in a step of its own.
 */
export async function createTicket(ticket: NewTicket): Promise<FiledTicket> {
  const [team, me, labelIds] = await Promise.all([teamId(), linear().viewer, Promise.all(ticket.labels.map(labelId))]);
  const payload = await linear().createIssue({
    teamId: team,
    assigneeId: me.id,
    title: ticket.title,
    description: ticket.description,
    labelIds,
    ...(ticket.parentId ? { parentId: ticket.parentId } : {}),
  });
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
      state: stateOf(i.state.type),
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

/**
 * Downloads a file from Linear's storage (`uploads.linear.app`), which answers 401 without the API
 * key. Null when it fails or is bigger than `maxBytes`: the caller leaves the link as it was.
 */
export async function downloadUpload(url: string, maxBytes: number): Promise<{ data: Buffer; contentType: string | null } | null> {
  try {
    const res = await fetch(url, { headers: { Authorization: config.linearApiKey() } });
    if (!res.ok) return null;
    if (Number(res.headers.get("content-length") ?? 0) > maxBytes) return null;
    const data = Buffer.from(await res.arrayBuffer());
    return data.length > maxBytes ? null : { data, contentType: res.headers.get("content-type") };
  } catch {
    return null;
  }
}

/** The ticket's labels now, by name: pick-up-tickets' copy may be minutes old by the time a run ends. */
export async function ticketLabels(ticketId: string): Promise<string[]> {
  return (await (await linear().issue(ticketId)).labels()).nodes.map((l) => l.name);
}

/** A ticket by its identifier (`REC-123`), or null when there's none. */
export async function ticketByIdentifier(identifier: string): Promise<{ id: string; identifier: string; title: string; url: string } | null> {
  const issue = await linear().issue(identifier).catch(() => null);
  return issue ? { id: issue.id, identifier: issue.identifier, title: issue.title, url: issue.url } : null;
}

/** The ticket's parent, with its labels by name, or null when it has none. */
export async function ticketParent(ticketId: string): Promise<{ id: string; identifier: string; labels: string[] } | null> {
  const data = await linear().client.request<
    { issue: { parent: { id: string; identifier: string; labels: { nodes: { name: string }[] } } | null } },
    { id: string }
  >(`query($id: String!) { issue(id: $id) { parent { id identifier labels { nodes { name } } } } }`, { id: ticketId });
  const p = data.issue.parent;
  return p ? { id: p.id, identifier: p.identifier, labels: p.labels.nodes.map((l) => l.name) } : null;
}

/** The ticket's sub-tickets, whatever their state, oldest first. Up to 250. */
export async function subTickets(ticketId: string): Promise<LabelledTicket[]> {
  const data = await linear().client.request<
    { issue: { children: { nodes: { id: string; identifier: string; title: string; url: string; createdAt: string; state: { type: string }; labels: { nodes: { name: string }[] } }[] } } },
    { id: string }
  >(
    `query($id: String!) { issue(id: $id) { children(first: 250) { nodes { id identifier title url createdAt state { type } labels { nodes { name } } } } } }`,
    { id: ticketId },
  );
  return data.issue.children.nodes
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((c) => ({ id: c.id, identifier: c.identifier, title: c.title, url: c.url, labels: c.labels.nodes.map((l) => l.name), state: stateOf(c.state.type) }));
}

/** How many of the ticket's sub-tickets are neither done nor cancelled. Up to 250. */
export async function openSubTickets(ticketId: string): Promise<number> {
  const data = await linear().client.request<{ issue: { children: { nodes: { state: { type: string } }[] } } }, { id: string }>(
    `query($id: String!) { issue(id: $id) { children(first: 250) { nodes { state { type } } } } }`,
    { id: ticketId },
  );
  return data.issue.children.nodes.filter((c) => c.state.type !== "completed" && c.state.type !== "canceled").length;
}

/** Linear's state type as the factory sees it: completed is done, canceled is cancelled, the rest open. */
function stateOf(type: string): Linked["state"] {
  return type === "completed" ? "done" : type === "canceled" ? "cancelled" : "open";
}

type RelationNodes = { nodes: { type: string; issue: { identifier: string; state: { type: string } } }[] };
const blockersOf = (inverse: RelationNodes): Linked[] =>
  inverse.nodes.filter((r) => r.type === "blocks").map((r) => ({ identifier: r.issue.identifier, state: stateOf(r.issue.state.type) }));

/** The tickets that block this one, in any state. Up to 50. */
export async function ticketBlockers(ticketId: string): Promise<Linked[]> {
  const data = await linear().client.request<{ issue: { inverseRelations: RelationNodes } }, { id: string }>(
    `query($id: String!) { issue(id: $id) { inverseRelations(first: 50) { nodes { type issue { identifier state { type } } } } } }`,
    { id: ticketId },
  );
  return blockersOf(data.issue.inverseRelations);
}

/** The tickets this one blocks, each with its state and every ticket that blocks it. Up to 50 of each. */
export async function blockedTickets(ticketId: string): Promise<(Linked & { id: string; blockers: Linked[] })[]> {
  const data = await linear().client.request<
    {
      issue: {
        relations: {
          nodes: { type: string; relatedIssue: { id: string; identifier: string; state: { type: string }; inverseRelations: RelationNodes } }[];
        };
      };
    },
    { id: string }
  >(
    `query($id: String!) { issue(id: $id) { relations(first: 50) { nodes { type relatedIssue {
      id identifier state { type } inverseRelations(first: 50) { nodes { type issue { identifier state { type } } } }
    } } } } }`,
    { id: ticketId },
  );
  return data.issue.relations.nodes
    .filter((r) => r.type === "blocks")
    .map(({ relatedIssue: d }) => ({ id: d.id, identifier: d.identifier, state: stateOf(d.state.type), blockers: blockersOf(d.inverseRelations) }));
}

/** A comment as a thread sees it: its id to reply to, and the comment it replies to, if any. */
export type ThreadedComment = {
  id: string;
  /** The top comment of the thread this one replies in; null for a top comment. */
  parentId: string | null;
  url: string;
  body: string;
  createdAt: string;
  /** Written by the owner of LINEAR_API_KEY (Oscar), or by the factory posting as him. */
  isMe: boolean;
};

/** Every comment on the ticket, replies included, oldest first. Up to 250. */
export async function ticketThreads(ticketId: string): Promise<ThreadedComment[]> {
  const data = await linear().client.request<
    { issue: { comments: { nodes: { id: string; url: string; body: string; createdAt: string; parent: { id: string } | null; user: { isMe: boolean } | null }[] } } },
    { id: string }
  >(
    `query($id: String!) { issue(id: $id) { comments(first: 250) { nodes { id url body createdAt parent { id } user { isMe } } } } }`,
    { id: ticketId },
  );
  return data.issue.comments.nodes
    .map((c) => ({ id: c.id, parentId: c.parent?.id ?? null, url: c.url, body: c.body, createdAt: c.createdAt, isMe: c.user?.isMe ?? false }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Posts a comment, or a reply in the thread of `parentId`, and returns its id and link. Not
 * idempotent: call it in a step of its own.
 */
export async function postComment(ticketId: string, body: string, parentId?: string): Promise<{ id: string; url: string }> {
  const payload = await linear().createComment({ issueId: ticketId, body, ...(parentId ? { parentId } : {}) });
  const posted = await payload.comment;
  if (!payload.success || !posted) throw new Error(`Linear refused the comment on ${ticketId}`);
  return { id: posted.id, url: posted.url };
}

/** A ticket with what it says, for a prompt. */
export type DescribedTicket = { id: string; identifier: string; title: string; url: string; description: string };

/** The team's open tickets with the label, whatever their assignee, newest first. Up to `first`, at most 250. */
export async function openTicketsWithLabel(label: string, first: number): Promise<DescribedTicket[]> {
  const data = await linear().client.request<
    { issues: { nodes: DescribedTicket[] } },
    { team: string; label: string; first: number }
  >(
    `query($team: String!, $label: String!, $first: Int!) {
      issues(first: $first, orderBy: createdAt, filter: {
        team: { key: { eq: $team } },
        labels: { some: { name: { eq: $label } } },
        state: { type: { nin: ["completed", "canceled"] } }
      }) { nodes { id identifier title url description } }
    }`,
    { team: config.linearTeam, label, first: Math.min(first, 250) },
  );
  return data.issues.nodes.map((i) => ({ ...i, description: i.description ?? "" }));
}
