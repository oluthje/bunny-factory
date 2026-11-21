// The orchestrator's own checks before it merges, whatever the agent judged: run right before the
// first merge, on what GitHub and Linear say then. `bulkBlockers` is the same for a PR into a bulk
// branch (src/bulk.ts), which no agent judges and no CI runs on. A PR that conflicts with its base,
// or is behind it, isn't a blocker but `stale`: the resolve task merges the base in, up to
// RESOLVE_ROUNDS times. Pure: it takes what index.ts fetched and does no I/O, so it is unit-tested
// in gates.test.ts.
import type { CiState } from "../../src/checks.ts";
import { isBulkBranch } from "../../src/bulk.ts";
import type { PrState } from "../../src/github.ts";
import { NO_AUTO_MERGE_LABEL } from "../../src/labels.ts";

/** Branches the factory never merges into: production is released by hand. */
export const PROTECTED_BASES = ["production"];

/** Resolve runs a ticket gets per implement run before a stale PR goes to Oscar. */
export const RESOLVE_ROUNDS = 3;

/** One open PR, as GitHub has it now, with its CI and the head the merge run judged. */
export type PrCheck = { repo: string; state: PrState; ci: CiState; judgedSha: string };

/**
 * Why the ticket's PRs can't merge, ticket-wide reasons first, then each PR's. Empty when they
 * all can. `labels` are the ticket's labels now.
 */
export function blockers({ prs, labels }: { prs: readonly PrCheck[]; labels: readonly string[] }): string[] {
  return [...ticketBlockers(labels), ...prs.flatMap((pr) => prBlockers(pr).map((why) => `${pr.repo}: ${why}`))];
}

function ticketBlockers(labels: readonly string[]): string[] {
  return labels.includes(NO_AUTO_MERGE_LABEL) ? [`\`${NO_AUTO_MERGE_LABEL}\` is on the ticket.`] : [];
}

const present = (b: string | null): b is string => b !== null;

/** A PR into a bulk branch: no CI, and no agent's verdict, so `judgedSha` is the head the run started on. */
export type BulkPrCheck = Omit<PrCheck, "ci">;

/**
 * Why the ticket's PRs can't merge into its bulk branch `base`. Without an agent's judgement, the
 * base is checked hard: it must be a bulk branch, never main or production, and every PR must target it.
 */
export function bulkBlockers({ prs, labels, base }: { prs: readonly BulkPrCheck[]; labels: readonly string[]; base: string }): string[] {
  if (!isBulkBranch(base)) return [`\`${base}\` isn't a bulk branch.`];
  const each = prs.flatMap((pr) => {
    if (!pr.state.open) return [`${pr.repo}: is no longer open.`];
    const wrongBase = pr.state.base !== base ? `targets \`${pr.state.base}\`, not the bulk branch \`${base}\`.` : null;
    return [wrongBase, ...stateBlockers(pr)].filter(present).map((why) => `${pr.repo}: ${why}`);
  });
  return [...ticketBlockers(labels), ...each];
}

function prBlockers(pr: PrCheck): string[] {
  const { state, ci } = pr;
  if (!state.open) return ["is no longer open."];
  return [
    PROTECTED_BASES.includes(state.base) ? `targets \`${state.base}\`, which is merged by hand.` : null,
    ...stateBlockers(pr),
    ci.state === "red" ? `CI failed: ${ci.failing.join(", ")}.` : null,
    ci.state === "pending" ? `CI is still running: ${ci.pending.join(", ")}.` : null,
  ].filter(present);
}

/** What stands in the way of an open PR, whatever its base. */
function stateBlockers({ state, judgedSha }: BulkPrCheck): (string | null)[] {
  return [state.draft ? "is a draft." : null, state.headSha !== judgedSha ? "has commits pushed after the merge run judged it." : null, mergeability(state)];
}

/**
 * What GitHub's mergeable state says, when it stands in the way and merging the base in won't fix
 * it. A draft is reported on its own, and a conflict or a branch behind its base by `staleness`.
 */
function mergeability(state: PrState): string | null {
  const { mergeable, mergeableState } = state;
  if (staleness(state)) return null;
  if (mergeable === null || mergeableState === "unknown") return "GitHub hasn't worked out whether it can merge.";
  if (mergeableState === "blocked") return "branch protection blocks it.";
  return null;
}

/** Why the open PR needs its base merged in, or null when it doesn't. */
export function staleness({ open, mergeable, mergeableState }: PrState): string | null {
  if (!open) return null;
  if (mergeable === false || mergeableState === "dirty") return "conflicts with its base.";
  if (mergeableState === "behind") return "is behind its base, and branch protection wants it up to date.";
  return null;
}

/** Each open PR that needs its base merged in, and why: the resolve task's work. */
export function stale(prs: readonly { repo: string; state: PrState }[]): string[] {
  return prs.flatMap((pr) => {
    const why = staleness(pr.state);
    return why ? [`${pr.repo}: ${why}`] : [];
  });
}

/**
 * What a merge run does with stale PRs, given how many resolve runs the ticket has had since its
 * last implement run: hand them to resolve, or to Oscar once RESOLVE_ROUNDS have not been enough.
 */
export function resolveRound(resolvesSoFar: number): { next: "resolve"; round: number } | { next: "human"; rounds: number } {
  return resolvesSoFar < RESOLVE_ROUNDS ? { next: "resolve", round: resolvesSoFar + 1 } : { next: "human", rounds: RESOLVE_ROUNDS };
}
