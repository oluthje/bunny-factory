// The orchestrator's own checks before it merges, whatever the agent judged: run right before the
// first merge, on what GitHub and Linear say then. Pure: it takes what index.ts fetched and does
// no I/O, so it is unit-tested in gates.test.ts.
import type { CiState } from "../../src/checks.ts";
import type { PrState } from "../../src/github.ts";
import { NO_AUTO_MERGE_LABEL } from "../../src/labels.ts";

/** Branches the factory never merges into: production is released by hand. */
export const PROTECTED_BASES = ["production"];

/** One open PR, as GitHub has it now, with its CI and the head the merge run judged. */
export type PrCheck = { repo: string; state: PrState; ci: CiState; judgedSha: string };

/**
 * Why the ticket's PRs can't merge, ticket-wide reasons first, then each PR's. Empty when they
 * all can. `labels` are the ticket's labels now; `pushed` the repos the merge run pushed to.
 */
export function blockers({ prs, labels, pushed }: { prs: readonly PrCheck[]; labels: readonly string[]; pushed: readonly string[] }): string[] {
  const ticket = [
    labels.includes(NO_AUTO_MERGE_LABEL) ? `\`${NO_AUTO_MERGE_LABEL}\` is on the ticket.` : null,
    pushed.length ? `The merge run pushed commits to ${pushed.join(", ")}; it must change nothing.` : null,
  ];
  return [...ticket, ...prs.flatMap((pr) => prBlockers(pr).map((why) => `${pr.repo}: ${why}`))].filter((b): b is string => b !== null);
}

function prBlockers({ state, ci, judgedSha }: PrCheck): string[] {
  if (!state.open) return ["is no longer open."];
  return [
    PROTECTED_BASES.includes(state.base) ? `targets \`${state.base}\`, which is merged by hand.` : null,
    state.draft ? "is a draft." : null,
    state.headSha !== judgedSha ? "has commits pushed after the merge run judged it." : null,
    mergeability(state),
    ci.state === "red" ? `CI failed: ${ci.failing.join(", ")}.` : null,
    ci.state === "pending" ? `CI is still running: ${ci.pending.join(", ")}.` : null,
  ].filter((b): b is string => b !== null);
}

/** What GitHub's mergeable state says, when it stands in the way. A draft is reported on its own. */
function mergeability({ mergeable, mergeableState }: PrState): string | null {
  if (mergeable === false || mergeableState === "dirty") return "conflicts with its base.";
  if (mergeable === null || mergeableState === "unknown") return "GitHub hasn't worked out whether it can merge.";
  if (mergeableState === "blocked") return "branch protection blocks it.";
  if (mergeableState === "behind") return "is behind its base, and branch protection wants it up to date.";
  return null;
}
