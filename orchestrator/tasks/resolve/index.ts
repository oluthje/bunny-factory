// `resolve` merges the run's base (main, or a bulk branch) into the ticket's branch when its PRs
// conflict with it or are behind it, resolves the conflicts, and checks the result. The merge task
// hands it the ticket (merge/gates.ts `stale`), and it hands the ticket back to merge, skipping
// review: merge still judges the new head and waits for CI. Nothing it commits rewrites history,
// so the factory pushes without force. With the stack for specs, no browser, and a short time
// limit: a stuck run frees its slot soon, and counts as one of merge's RESOLVE_ROUNDS. On a bulk
// parent it fixes the batch's PR into main, and hands back to Oscar, who merges that one.
// The tree of its prompt is in tasks/README.md.
import { isBulkBranch } from "../../src/bulk.ts";
import { commentOnPr, prState } from "../../src/github.ts";
import { markForGithub } from "../../src/logic.ts";
import { finish, plural, prRef, type Outcome, type Prepared, type RunContext, type Stop, type Task } from "../../src/task.ts";
import { staleness } from "../merge/gates.ts";
import { promptVars, RESOLUTION } from "./prompt.ts";

export const resolve: Task = {
  skills: ["factory-rules", "factory-stack"],
  docs: [],
  browser: false,
  stack: true,
  branch: "required",
  timeLimitMinutes: 30,
  clock: null,
  onBulkParent: true, // merges main into the batch's bulk branch, for its PR into main
  prepare,
};

async function prepare({ step, runId, ticket, branch, base, timeLimitMinutes, openPrs }: RunContext): Promise<Prepared | Stop> {
  const repos = Object.keys(openPrs);
  if (repos.length === 0) return { stop: { end: { status: "succeeded", next: "human" }, text: `Not resolving: \`${branch}\` has no open PR.` } };

  const prs = await step.run("read-prs", async () =>
    Promise.all(repos.map(async (repo) => ({ repo, url: openPrs[repo]!, why: staleness(await prState(openPrs[repo]!)) }))),
  );

  return {
    vars: promptVars(prs),
    outputs: { resolution: RESOLUTION },
    pass: null,

    conclude: async ({ files, timedOut, pushed, commits }: Outcome) => {
      const resolution = files.resolution!.trim();
      const status = pushed.length > 0 ? "succeeded" : timedOut ? "timed_out" : "no_changes";
      const urls = Object.values(openPrs);

      // The resolution on each PR, where the merge commit shows: what was decided, and why.
      await step.run("comment-on-prs", async () => {
        if (!resolution) return;
        const body = markForGithub(`Factory resolve run of [${ticket.identifier}](${ticket.url}) (run \`${runId}\`): merging \`${base}\` in.\n\n${resolution}`);
        for (const url of urls) await commentOnPr(url, body).catch((err) => console.warn(`[${runId}] couldn't comment on ${url}: ${err}`));
      });

      await step.run("report", async () => {
        const head =
          pushed.length > 0
            ? `Merged \`${base}\` into ${urls.map(prRef).join(", ")}: pushed ${plural(commits, "commit")}.`
            : timedOut
              ? `Timed out after ${timeLimitMinutes} minutes without resolving.`
              : `Didn't resolve: nothing committed.`;
        // A bulk parent's PR into main is Oscar's to merge; any other goes back to merge.
        const next = pushed.length > 0 && !isBulkBranch(branch) ? "merge" : "human";
        await finish({
          runId,
          ticketId: ticket.id,
          end: { status, next },
          text: [head, resolution || "The agent wrote no resolution."].join("\n\n"),
          record: { prUrls: urls },
        });
      });
      return { status, prUrls: urls };
    },
  };
}
