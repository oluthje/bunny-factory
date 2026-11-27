// fix-ci's decisions before any runner: whether a red check is the branch's to fix, how many
// fix rounds a ticket gets, and whether green CI skips review. Pure: it takes what index.ts fetched and does no I/O, so it is
// unit-tested in gates.test.ts.
import { SKIP_REVIEW_LABEL } from "../../src/labels.ts";

/** Runs that fix CI a ticket gets per implement run before a red check goes to Oscar. */
export const FIX_ROUNDS = 3;

/**
 * Whether this run may fix, given how many fix-ci runs the ticket has had since its last
 * implement run, this one included. Every earlier one found CI red and tried a fix: a run that
 * finds CI green hands off to review and ends the chain.
 */
export function fixRound(runsSinceImplement: number): { next: "fix"; round: number } | { next: "human"; rounds: number } {
  const tried = Math.max(0, runsSinceImplement - 1);
  return tried < FIX_ROUNDS ? { next: "fix", round: tried + 1 } : { next: "human", rounds: FIX_ROUNDS };
}

/**
 * The checks failing on the PRs that fail on the base's head too, by name. When it's all of them,
 * the base is red and the branch can't make CI green: that's Oscar's, not this ticket's, to fix.
 */
export function alsoRedOnBase(failing: readonly string[], baseFailing: readonly string[]): string[] {
  return failing.filter((name) => baseFailing.includes(name));
}

/**
 * Where `oscar-factory:skip-review` sends green CI straight to merge from, or null when the ticket
 * goes to review: the ticket's own label, or its parent's, which covers every sub-ticket. A bulk
 * parent's own PR into main is still reviewed: on the parent, the label is for its sub-tickets.
 */
export function skipReviewFrom(args: { bulkParent: boolean; labels: readonly string[]; parentLabels: readonly string[] }): "ticket" | "parent" | null {
  if (args.bulkParent) return null;
  if (args.labels.includes(SKIP_REVIEW_LABEL)) return "ticket";
  return args.parentLabels.includes(SKIP_REVIEW_LABEL) ? "parent" : null;
}
