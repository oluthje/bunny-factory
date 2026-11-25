// Bulk branches: a parent ticket with `oscar-factory:bulk` gets `factory/bulk/<parent>`, its
// sub-tickets' PRs merge into it with no per-PR human review, and Oscar reviews the batch as one PR
// into main. Here: the branch's name, where a run works (its base and branch), and what the
// bulk-batches sweep does next with each bulk branch. Pure: no I/O, so it is unit-tested in
// test/bulk.test.ts. The I/O is in functions/run-ticket.ts (placing a run) and
// functions/bulk-batches.ts (the final PR); the merge task merges into the branch.
import { config } from "./config.ts";
import { BULK_LABEL } from "./labels.ts";
import type { Ticket } from "./logic.ts";

export const BULK_PREFIX = "factory/bulk/";

/** The parent ticket's bulk branch. */
export function bulkBranch(parentIdentifier: string): string {
  return `${BULK_PREFIX}${parentIdentifier}`;
}

/** The parent ticket a bulk branch belongs to, or null when the branch isn't one. */
export function bulkParentOf(branch: string): string | null {
  return branch.startsWith(BULK_PREFIX) && branch.length > BULK_PREFIX.length ? branch.slice(BULK_PREFIX.length) : null;
}

export function isBulkBranch(branch: string): boolean {
  return bulkParentOf(branch) !== null;
}

/**
 * Where a run works: the branch its repos build from (`base`), the branch it checks out and pushes,
 * and whether the ticket is a bulk parent, which only a task with `onBulkParent` may run on.
 */
export type Placement = { base: string; branch: string; bulkParent: boolean };

/**
 * A parent is in bulk mode while it has the label, or once its bulk branch exists in any repo: then
 * taking the label off changes nothing, and Oscar ends the batch by closing its PR into main.
 * - The parent itself, once its bulk branch exists, works on that branch, into main: only to fix
 *   the final PR. Before, it is a ticket like any other.
 * - Its direct sub-tickets build from the bulk branch, and their PRs target it. A grandchild looks
 *   only at its own parent.
 * - A ticket whose task chose its base from the ticket (`Task.base`) builds from that, whatever
 *   its parent: a bulk parent is still one, so only a task with `onBulkParent` runs on it.
 * - Everything else is on its own branch, from main.
 */
export function placeRun(args: {
  ticket: Ticket;
  parent: { identifier: string; labels: readonly string[] } | null;
  bulkBranchExists: (branch: string) => boolean;
  chosenBase: string | null;
}): Placement {
  const { ticket, parent, bulkBranchExists, chosenBase } = args;
  const inBulk = (t: { identifier: string; labels: readonly string[] }) => t.labels.includes(BULK_LABEL) || bulkBranchExists(bulkBranch(t.identifier));
  if (bulkBranchExists(bulkBranch(ticket.identifier))) return { base: config.baseBranch, branch: bulkBranch(ticket.identifier), bulkParent: true };
  if (chosenBase) return { base: chosenBase, branch: ticket.branchName, bulkParent: false };
  if (parent && inBulk(parent)) return { base: bulkBranch(parent.identifier), branch: ticket.branchName, bulkParent: false };
  return { base: config.baseBranch, branch: ticket.branchName, bulkParent: false };
}

/** What the sweep does next with one repo's bulk branch. */
export type BatchStep = "wait" | "open-draft" | "mark-ready" | "close-out" | "abandon" | "delete-empty";

/**
 * - No PR into main yet: open a draft once anything has merged into the branch.
 * - A draft: mark it ready, and hand the parent to Oscar, once no sub-ticket is open.
 * - Merged: delete the branch, and close the parent once every repo's PR has merged.
 * - Closed without merging: delete the branch and hand the parent to Oscar.
 * - Nothing merged into it, and no sub-ticket open: delete it, so it can't hold the batch open.
 * `pr` is the newest PR from the branch into main, in any state. A finished PR whose head isn't the
 * branch's is from an earlier batch under the same name, and doesn't count.
 */
export function batchStep(args: {
  pr: { state: "open" | "merged" | "closed"; draft: boolean; headSha: string } | null;
  branchSha: string;
  aheadOfMain: number;
  subTicketsOpen: number;
}): BatchStep {
  const { branchSha, aheadOfMain, subTicketsOpen } = args;
  const pr = args.pr && (args.pr.state === "open" || args.pr.headSha === branchSha) ? args.pr : null;
  if (!pr) return aheadOfMain > 0 ? "open-draft" : subTicketsOpen === 0 ? "delete-empty" : "wait";
  if (pr.state === "merged") return "close-out";
  if (pr.state === "closed") return "abandon";
  return pr.draft && subTicketsOpen === 0 ? "mark-ready" : "wait";
}
