// Waiting for CI on a run's PRs, before its agent starts: polls the git host (github.ts) inside
// Inngest steps, and sums each poll up with checks.ts. Shared by the tasks that gate on CI
// (merge, fix-ci). Its step ids, `ci-poll-<i>` and `ci-wait-<i>`, are a contract with in-flight runs.
import { ciState, combineCi, type CiState } from "./checks.ts";
import { commitChecks } from "./github.ts";
import type { Step } from "./task.ts";

/** How long to wait for CI, polling every CI_POLL_MINUTES, before giving up on it. */
export const CI_POLLS = 15;
export const CI_POLL_MINUTES = 2;
/** How long the wait lasts at most, in minutes, for reports. */
export const CI_WAIT_MINUTES = (CI_POLLS - 1) * CI_POLL_MINUTES;
/**
 * Polls a PR with no checks at all counts as still pending: right after a push, GitHub hasn't
 * registered the checks yet. Past them, no checks means the repo runs none on this PR.
 */
const NO_CHECKS_GRACE_POLLS = 3;

/**
 * CI across the repos' heads, once it's done: green or red, or pending when the wait ran out.
 * Red as soon as any check fails, even with others still running.
 */
export async function waitForCi(step: Step, repos: readonly string[], heads: Record<string, string>): Promise<CiState> {
  let ci: CiState = { state: "pending", failing: [], pending: [], checks: 0 };
  for (let i = 0; i < CI_POLLS; i++) {
    const each = await step.run(`ci-poll-${i}`, async () =>
      Promise.all(repos.map(async (repo) => ciState(await commitChecks(repo, heads[repo]!)))),
    );
    ci = combineCi(each);
    const unseen = each.some((s) => s.checks === 0);
    if ((ci.state !== "pending" && !(unseen && i < NO_CHECKS_GRACE_POLLS)) || i === CI_POLLS - 1) break;
    await step.sleep(`ci-wait-${i}`, `${CI_POLL_MINUTES}m`);
  }
  return ci;
}
