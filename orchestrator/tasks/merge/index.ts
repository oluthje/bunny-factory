// `merge` decides whether the ticket's open PRs are an easy call, and merges them all or none. The
// orchestrator waits for CI to finish first; the agent reads the PRs, review's findings and the
// ticket, read-only and without the stack, and writes a verdict per PR; then the orchestrator
// checks the PRs again itself and merges them in order, unless `config.mergeDryRun` holds it to
// saying what it would merge. Oscar's `oscar-factory:no-auto-merge` flag stops it before any of
// that. The tree of its prompt is in tasks/README.md.
import { ciState, type CiState } from "../../src/checks.ts";
import { config } from "../../src/config.ts";
import { commentOnPr, commitChecks, deleteBranch, getPrBody, mergePr, prComments, prReviews, prState, reviewThreads } from "../../src/github.ts";
import { NO_AUTO_MERGE_LABEL } from "../../src/labels.ts";
import { ticketComments, ticketLabels } from "../../src/linear.ts";
import { finish, passResult, type Outcome, type Prepared, type RunContext, type Stop, type Task } from "../../src/task.ts";
import type { RunEnd } from "../../src/transitions.ts";
import { blockers } from "./gates.ts";
import { mergeOrder } from "./order.ts";
import { promptVars, VERDICT } from "./prompt.ts";
import { ciStopText, mergedText, notMergingText, partialText, prNote, wouldMergeText } from "./report.ts";
import { holdouts, mergeVerdictJsonSchema, parseMergeVerdict, verdictRetryPrompt } from "./verdict.ts";

export const merge: Task = {
  skills: ["factory-rules"],
  docs: ["rubric.md"], // read at step 2
  browser: false,
  stack: false,
  branch: "required",
  timeLimitMinutes: 10,
  prepare,
};

/** How long to wait for CI, polling every CI_POLL_MINUTES, before handing the ticket to Oscar. */
const CI_POLLS = 15;
const CI_POLL_MINUTES = 2;

const stop = (text: string, end: RunEnd = { status: "succeeded", next: "human" }): Stop => ({ stop: { end, text } });

async function prepare({ step, runId, ticket, branch, heads, openPrs, timeLimitMinutes }: RunContext): Promise<Prepared | Stop> {
  if (ticket.labels.includes(NO_AUTO_MERGE_LABEL)) return stop(`Not merging: \`${NO_AUTO_MERGE_LABEL}\` is on the ticket.`);
  const repos = Object.keys(openPrs);
  if (repos.length === 0) return stop("Not merging: the branch has no open PR.");
  // The ticket's change is all of its branch: a repo with it but no PR would be left out.
  const unpaired = Object.keys(heads).filter((r) => !openPrs[r]);
  if (unpaired.length) return stop(`Not merging: \`${branch}\` is in ${unpaired.join(", ")} with no open PR.`);
  const prRepos = repos as [string, ...string[]];

  // CI on the heads the agent will read, until it's done. Red, or still running when the wait
  // runs out, goes to Oscar without an agent.
  let ci: CiState = { state: "pending", failing: [], pending: [], checks: 0 };
  for (let i = 0; i < CI_POLLS; i++) {
    ci = await step.run(`ci-poll-${i}`, async () =>
      ciState.combine(await Promise.all(prRepos.map(async (repo) => ciState(await commitChecks(repo, heads[repo]!))))),
    );
    if (ci.state !== "pending" || i === CI_POLLS - 1) break;
    await step.sleep(`ci-wait-${i}`, `${CI_POLL_MINUTES}m`);
  }
  if (ci.state !== "green") return stop(ciStopText(ci, CI_POLLS * CI_POLL_MINUTES));

  const context = await step.run("gather-context", async () => ({
    prs: await Promise.all(
      prRepos.map(async (repo) => {
        const url = openPrs[repo]!;
        return {
          repo,
          url,
          ci: ciState(await commitChecks(repo, heads[repo]!)),
          body: await getPrBody(url),
          reviews: await prReviews(url),
          comments: await prComments(url),
          threads: await reviewThreads(url),
        };
      }),
    ),
    ticketComments: await ticketComments(ticket.id),
  }));

  return {
    vars: promptVars(context),
    outputs: { verdict: VERDICT },
    pass: {
      schema: mergeVerdictJsonSchema(prRepos),
      parse: (text, stderr) => parseMergeVerdict(text, prRepos, stderr),
      retryPrompt: verdictRetryPrompt,
      needs: VERDICT,
    },

    conclude: async ({ files, structured, passError, timedOut, pushed }: Outcome) => {
      const written = files.verdict!.trim();
      const parsed = written ? passResult(passError, () => parseMergeVerdict(structured, prRepos)) : null;

      // No verdict code can read: nothing merges.
      if (!parsed?.ok) {
        const status = timedOut ? "timed_out" : "failed";
        const why = !written
          ? timedOut
            ? `Timed out after ${timeLimitMinutes} minutes without writing a verdict.`
            : "Finished without writing a verdict."
          : `Wrote a verdict code can't read: ${parsed!.ok ? "" : parsed!.error}`;
        await step.run("report", () =>
          finish({ runId, ticketId: ticket.id, end: { status, next: "human" }, text: `Not merging. ${why}`, record: { error: why } }),
        );
        return { status, prUrls: [] };
      }
      const verdict = parsed.value;
      const held = holdouts(verdict);
      const order = mergeOrder(verdict.order, prRepos);

      // The orchestrator's own checks, on what GitHub and Linear say now, right before any merge.
      // The dry-run setting is read here too, so a replay never changes its mind.
      const gate = await step.run("check-gates", async () => ({
        blockers: blockers({
          labels: await ticketLabels(ticket.id),
          pushed,
          prs: await Promise.all(
            prRepos.map(async (repo) => {
              const state = await prState(openPrs[repo]!);
              return { repo, state, ci: ciState(await commitChecks(repo, state.headSha)), judgedSha: heads[repo]! };
            }),
          ),
        }),
        dryRun: config.mergeDryRun,
      }));

      // Held back, by the agent or the checks: say why on every PR and the ticket.
      if (held.length || gate.blockers.length) {
        const text = notMergingText({ summary: verdict.summary, holdouts: held, blockers: gate.blockers, urls: openPrs });
        await step.run("report", async () => {
          for (const url of Object.values(openPrs)) await commentOnPr(url, prNote(ticket, text, runId));
          await finish({ runId, ticketId: ticket.id, end: { status: "succeeded", next: "human" }, text, record: { prUrls: Object.values(openPrs) } });
        });
        return { status: "succeeded", prUrls: Object.values(openPrs) };
      }

      if (gate.dryRun) {
        const text = wouldMergeText(verdict.summary, order, openPrs);
        await step.run("report", async () => {
          for (const url of Object.values(openPrs)) await commentOnPr(url, prNote(ticket, text, runId));
          await finish({ runId, ticketId: ticket.id, end: { status: "succeeded", next: "human" }, text, record: { prUrls: Object.values(openPrs) } });
        });
        return { status: "succeeded", prUrls: Object.values(openPrs) };
      }

      // In order, each only if its head is still the one judged; stop at the first that fails.
      // Each merge is its own step, so a replay never merges twice.
      const merged: string[] = [];
      let failed: { repo: string; error: string } | null = null;
      for (const repo of order) {
        const result = await step.run(`merge-${repo}`, async () => {
          try {
            await mergePr(openPrs[repo]!, heads[repo]!);
          } catch (err) {
            return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
          }
          // The merge went in: a branch left behind is untidy, not a failure.
          await deleteBranch(repo, branch).catch((err) => console.warn(`[${runId}] couldn't delete ${repo}/${branch}: ${err}`));
          return { ok: true as const };
        });
        if (!result.ok) {
          failed = { repo, error: result.error.slice(0, 500) };
          break;
        }
        merged.push(repo);
      }
      const prUrls = merged.map((r) => openPrs[r]!);

      if (failed) {
        const { error } = failed;
        const text = partialText({ merged, failed, rest: order.slice(merged.length + 1), urls: openPrs });
        await step.run("report", async () => {
          for (const url of Object.values(openPrs)) await commentOnPr(url, prNote(ticket, text, runId)).catch(() => {});
          await finish({ runId, ticketId: ticket.id, end: { status: "failed", next: "human" }, text, record: { prUrls, error } });
        });
        return { status: "failed", prUrls };
      }

      await step.run("report", () =>
        finish({ runId, ticketId: ticket.id, end: { status: "succeeded", next: "done" }, text: mergedText(verdict.summary, order, openPrs), record: { prUrls } }),
      );
      return { status: "succeeded", prUrls };
    },
  };
}
