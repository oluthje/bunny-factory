// `fix-ci` stands between implement and review: it waits for CI on the ticket's PRs, and only
// green CI goes on to review. Before any runner, it waits for CI as merge does (src/ci-wait.ts):
// green hands the ticket to review, still running when the wait runs out goes to Oscar, and red
// starts the agent with each failed check's log. The agent reproduces the failure, fixes it in the
// ticket's code, and commits; the factory pushes without force and hands the ticket back to
// fix-ci, which waits for CI on the new head. A failure the base has too (gates.ts
// `alsoRedOnBase`) isn't the ticket's to fix and goes to Oscar, as do red checks past FIX_ROUNDS
// since the last implement run. With the stack for running the checks, no browser, and a short
// time limit. The tree of its prompt is in tasks/README.md.
import { isBulkBranch } from "../../src/bulk.ts";
import { ciState } from "../../src/checks.ts";
import { CI_WAIT_MINUTES, waitForCi } from "../../src/ci-wait.ts";
import { countRunsSince } from "../../src/db/index.ts";
import { branchSha, commentOnPr, commitChecks, failedChecks } from "../../src/github.ts";
import { markForGithub } from "../../src/logic.ts";
import { finish, plural, prRef, type Outcome, type Prepared, type RunContext, type Stop, type Task } from "../../src/task.ts";
import type { RunEnd } from "../../src/transitions.ts";
import { alsoRedOnBase, FIX_ROUNDS, fixRound } from "./gates.ts";
import { logExcerpt } from "./logs.ts";
import { FIX, promptVars } from "./prompt.ts";

export const fixCi: Task = {
  skills: ["factory-rules", "factory-stack"],
  docs: [],
  browser: false,
  stack: true,
  branch: "required",
  base: null,
  timeLimitMinutes: 30,
  clock: null,
  onBulkParent: true, // gates the PR from a bulk parent's branch into main, as implement's next step
  prepare,
  watch: null,
};

const stop = (text: string, end: RunEnd = { status: "succeeded", next: "human" }): Stop => ({ stop: { end, text } });
const toReview = (text: string): Stop => stop(`${text}\n\nHanding to review.`, { status: "succeeded", next: "review" });

async function prepare({ step, runId, ticket, branch, base, heads, openPrs, timeLimitMinutes }: RunContext): Promise<Prepared | Stop> {
  const repos = Object.keys(openPrs);
  if (repos.length === 0) return stop(`Not checking CI: \`${branch}\` has no open PR.`);
  // CI runs only on PRs into main: a sub-ticket's PR into its bulk branch has none to wait for.
  if (isBulkBranch(base)) return toReview(`No CI runs on PRs into \`${base}\`.`);

  const ci = await waitForCi(step, repos, heads);
  if (ci.state === "green") {
    return toReview(ci.checks === 0 ? "CI is green: no checks ran on the PRs." : `CI is green on ${repos.map((r) => prRef(openPrs[r]!)).join(", ")}: ${plural(ci.checks, "check")} passed.`);
  }
  if (ci.state === "pending") return stop(`CI was still running after ${CI_WAIT_MINUTES} minutes: ${ci.pending.join(", ")}.`);

  const round = await step.run("count-rounds", () => fixRound(countRunsSince(ticket.id, "fix-ci", "implement")));
  if (round.next === "human") {
    return stop(`CI failed: ${ci.failing.join(", ")}. ${plural(round.rounds, "fix round")} since the last implement run didn't make it green.`);
  }

  // Each PR's failed checks, with only the log's tail kept: a raw log can run to megabytes, too big
  // for a step's memoized result. And the same checks on the base's head, to tell a red base apart.
  const red = await step.run("read-failures", async () =>
    Promise.all(
      repos.map(async (repo) => {
        const checks = (await failedChecks(repo, heads[repo]!)).map((c) => ({ ...c, log: c.log ? logExcerpt(c.log) : null }));
        const baseSha = await branchSha(repo, base);
        const baseFailing = baseSha ? ciState(await commitChecks(repo, baseSha)).failing : [];
        return { repo, url: openPrs[repo]!, checks, alsoOnBase: alsoRedOnBase(checks.map((c) => c.name), baseFailing) };
      }),
    ),
  );
  const failing = red.flatMap((p) => p.checks.map((c) => `${p.repo}: ${c.name}`));
  const onBase = red.flatMap((p) => p.alsoOnBase.map((name) => `${p.repo}: ${name}`));
  // A check re-run since the poll can leave nothing failed to read.
  if (!failing.length) return stop(`CI was red on ${ci.failing.join(", ")}, but no check has failed on the PRs' heads since. Queue \`fix-ci\` again to wait for it.`);
  if (onBase.length === failing.length) {
    return stop(`CI failed, and \`${base}\` fails the same checks on its head: ${onBase.join(", ")}. Fix \`${base}\` first, then queue \`fix-ci\` again.`);
  }

  return {
    vars: promptVars(red, round.round, FIX_ROUNDS),
    outputs: { fix: FIX },
    pass: null,

    conclude: async ({ files, timedOut, pushed, commits }: Outcome) => {
      const fix = files.fix!.trim();
      const status = pushed.length > 0 ? "succeeded" : timedOut ? "timed_out" : "no_changes";
      const urls = Object.values(openPrs);

      // The fix on each PR, beside the commits it pushed: what failed, and why it passes now.
      await step.run("comment-on-prs", async () => {
        if (!fix) return;
        const body = markForGithub(`Factory fix-ci run of [${ticket.identifier}](${ticket.url}) (run \`${runId}\`): CI failed on ${failing.join(", ")}.\n\n${fix}`);
        for (const url of urls) await commentOnPr(url, body).catch((err) => console.warn(`[${runId}] couldn't comment on ${url}: ${err}`));
      });

      await step.run("report", async () => {
        const head =
          pushed.length > 0
            ? `CI failed on ${failing.join(", ")}: pushed ${plural(commits, "commit")} to ${urls.map(prRef).join(", ")}. Waiting for CI again.`
            : timedOut
              ? `CI failed on ${failing.join(", ")}. Timed out after ${timeLimitMinutes} minutes without a fix.`
              : `CI failed on ${failing.join(", ")}. Didn't fix it: nothing committed.`;
        // A pushed fix comes back here, to wait for CI on the new head.
        await finish({
          runId,
          ticketId: ticket.id,
          end: { status, next: pushed.length > 0 ? "fix-ci" : "human" },
          text: [head, fix || "The agent wrote no fix."].join("\n\n"),
          record: { prUrls: urls },
        });
      });
      return { status, prUrls: urls };
    },
  };
}
