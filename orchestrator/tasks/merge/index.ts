// `merge` decides whether the ticket's open PRs are an easy call, and merges them all or none. The
// orchestrator waits for CI to finish first; the agent reads the PRs, review's findings and the
// ticket, read-only and without the stack, and writes a verdict per PR; then the orchestrator
// checks the PRs again itself and merges them in order, unless `config.mergeDryRun` holds it to
// saying what it would merge. Oscar's `oscar-factory:no-auto-merge` flag stops it before any of
// that. Into a bulk branch (src/bulk.ts) it takes `mergeIntoBulk` instead: no CI to wait for, no
// agent, only the orchestrator's checks, then a squash merge, live whatever the dry-run setting,
// since Oscar reviews the batch's PR into main. The tree of its prompt is in tasks/README.md.
import { isBulkBranch } from "../../src/bulk.ts";
import { ciState, combineCi, type CiState } from "../../src/checks.ts";
import { config } from "../../src/config.ts";
import { commentOnPr, commitChecks, deleteBranch, getPrBody, mergePr, type MergeMethod, prComments, prReviews, prState, reviewThreads } from "../../src/github.ts";
import { NO_AUTO_MERGE_LABEL } from "../../src/labels.ts";
import { blockedTickets, closeTicket, comment, ticketComments, ticketLabels } from "../../src/linear.ts";
import { linearComment, nowUnblocked } from "../../src/logic.ts";
import { finish, passResult, type Outcome, type Prepared, type RunContext, type Step, type Stop, type Task } from "../../src/task.ts";
import type { RunEnd } from "../../src/transitions.ts";
import { blockers, bulkBlockers } from "./gates.ts";
import { mergeOrder } from "./order.ts";
import { promptVars, VERDICT } from "./prompt.ts";
import { bulkMergedText, ciStopText, mergedText, notMergingText, partialText, prNote, wouldMergeText } from "./report.ts";
import { holdouts, mergeVerdictJsonSchema, parseMergeVerdict, verdictRetryPrompt } from "./verdict.ts";

export const merge: Task = {
  skills: ["factory-rules"],
  docs: ["rubric.md"], // read at step 2
  browser: false,
  stack: false,
  branch: "read", // reads the PRs; anything it commits stays on the runner
  timeLimitMinutes: 10,
  clock: null,
  onBulkParent: false,
  prepare,
};

/** How long to wait for CI, polling every CI_POLL_MINUTES, before handing the ticket to Oscar. */
const CI_POLLS = 15;
const CI_POLL_MINUTES = 2;
/**
 * Polls a PR with no checks at all counts as still pending: right after a push, GitHub hasn't
 * registered the checks yet. Past them, no checks means the repo runs none on this PR.
 */
const NO_CHECKS_GRACE_POLLS = 3;
/** Tries per merge, for a git host error that may pass: a 5xx or a dropped connection. */
const MERGE_TRIES = 3;

const stop = (text: string, end: RunEnd = { status: "succeeded", next: "human" }): Stop => ({ stop: { end, text } });

async function prepare({ step, runId, ticket, branch, base, heads, openPrs, timeLimitMinutes }: RunContext): Promise<Prepared | Stop> {
  if (ticket.labels.includes(NO_AUTO_MERGE_LABEL)) return stop(`Not merging: \`${NO_AUTO_MERGE_LABEL}\` is on the ticket.`);
  const repos = Object.keys(openPrs);
  if (repos.length === 0) return stop("Not merging: the branch has no open PR.");
  // The ticket's change is all of its branch: a repo with it but no PR would be left out.
  const unpaired = Object.keys(heads).filter((r) => !openPrs[r]);
  if (unpaired.length) return stop(`Not merging: \`${branch}\` is in ${unpaired.join(", ")} with no open PR.`);
  const prRepos = repos as [string, ...string[]];
  if (isBulkBranch(base)) return mergeIntoBulk({ step, runId, ticket, branch, base, heads, openPrs, prRepos });

  // CI on the heads the agent will read, until it's done. Red, or still running when the wait
  // runs out, goes to Oscar without an agent.
  let ci: CiState = { state: "pending", failing: [], pending: [], checks: 0 };
  for (let i = 0; i < CI_POLLS; i++) {
    const each = await step.run(`ci-poll-${i}`, async () =>
      Promise.all(prRepos.map(async (repo) => ciState(await commitChecks(repo, heads[repo]!)))),
    );
    ci = combineCi(each);
    const unseen = each.some((s) => s.checks === 0);
    if ((ci.state !== "pending" && !(unseen && i < NO_CHECKS_GRACE_POLLS)) || i === CI_POLLS - 1) break;
    await step.sleep(`ci-wait-${i}`, `${CI_POLL_MINUTES}m`);
  }
  if (ci.state !== "green") return stop(ciStopText(ci, (CI_POLLS - 1) * CI_POLL_MINUTES));

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

    conclude: async ({ files, structured, passError, timedOut }: Outcome) => {
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
          prs: await Promise.all(
            prRepos.map(async (repo) => {
              const state = await prState(openPrs[repo]!);
              return { repo, state, ci: ciState(await commitChecks(repo, state.headSha)), judgedSha: heads[repo]! };
            }),
          ),
        }),
        dryRun: config.mergeDryRun,
      }));

      // On every PR, then the ticket, each its own step: a ticket report that fails and retries
      // doesn't post on the PRs again.
      const reportOnAll = async (text: string, end: RunEnd, record: Parameters<typeof finish>[0]["record"]) => {
        await step.run("comment-on-prs", async () => {
          for (const url of Object.values(openPrs)) {
            await commentOnPr(url, prNote(ticket, text, runId)).catch((err) => console.warn(`[${runId}] couldn't comment on ${url}: ${err}`));
          }
        });
        await step.run("report", () => finish({ runId, ticketId: ticket.id, end, text, record }));
      };
      const allUrls = Object.values(openPrs);

      // Held back, by the agent or the checks: say why on every PR and the ticket.
      if (held.length || gate.blockers.length) {
        const text = notMergingText({ summary: verdict.summary, holdouts: held, blockers: gate.blockers, urls: openPrs });
        await reportOnAll(text, { status: "succeeded", next: "human" }, { prUrls: allUrls });
        return { status: "succeeded", prUrls: allUrls };
      }

      if (gate.dryRun) {
        await reportOnAll(wouldMergeText(verdict.summary, order, openPrs), { status: "succeeded", next: "human" }, { prUrls: allUrls });
        return { status: "succeeded", prUrls: allUrls };
      }

      const { merged, failed } = await mergeInOrder({ step, runId, branch, order, heads, openPrs, method: "merge" });
      const prUrls = merged.map((r) => openPrs[r]!);

      if (failed) {
        const text = partialText({ merged, failed, rest: order.slice(merged.length + 1), urls: openPrs });
        await reportOnAll(text, { status: "failed", next: "human" }, { prUrls, error: failed.error });
        return { status: "failed", prUrls };
      }

      await step.run("report", () =>
        finish({ runId, ticketId: ticket.id, end: { status: "succeeded", next: "done" }, text: mergedText(verdict.summary, order, openPrs), record: { prUrls } }),
      );
      return { status: "succeeded", prUrls };
    },
  };
}

/**
 * Merges the PRs in order, each only if its head is still the one judged, and stops at the first
 * that fails. Each merge is its own step, so a replay never merges twice. A try that GitHub took
 * but whose answer was lost shows up as already merged, and counts.
 */
async function mergeInOrder(args: {
  step: Step;
  runId: string;
  branch: string;
  order: readonly string[];
  heads: Record<string, string>;
  openPrs: Record<string, string>;
  method: MergeMethod;
}): Promise<{ merged: string[]; failed: { repo: string; error: string } | null }> {
  const { step, runId, branch, order, heads, openPrs, method } = args;
  const merged: string[] = [];
  for (const repo of order) {
    const result = await step.run(`merge-${repo}`, async () => {
      const url = openPrs[repo]!;
      let error = "";
      for (let attempt = 0; attempt < MERGE_TRIES; attempt++) {
        try {
          await mergePr(url, heads[repo]!, method);
          error = "";
          break;
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
        const now = await prState(url).catch(() => null);
        if (now?.merged) {
          error = "";
          break;
        }
        // GitHub said no (a 4xx): asking again won't change its mind.
        if (/: 4\d\d /.test(error)) break;
        await new Promise((r) => setTimeout(r, 5000));
      }
      if (error) return { ok: false as const, error };
      // The merge went in: a branch left behind is untidy, not a failure.
      await deleteBranch(repo, branch).catch((err) => console.warn(`[${runId}] couldn't delete ${repo}/${branch}: ${err}`));
      return { ok: true as const };
    });
    if (!result.ok) return { merged, failed: { repo, error: result.error.slice(0, 500) } };
    merged.push(repo);
  }
  return { merged, failed: null };
}

/**
 * Into a bulk branch: no CI runs there and no agent judges, so the orchestrator's checks are the
 * whole gate (`bulkBlockers`), on the heads the run started on. Then a squash merge per PR, live
 * whatever `FACTORY_MERGE_DRY_RUN` says, and the sub-ticket is done: the parent's PR into main is
 * where Oscar reads it. Done frees each ticket it blocked whose blockers are now all closed. Ends the run before any runner, with a `Stop`.
 */
async function mergeIntoBulk(args: {
  step: Step;
  runId: string;
  ticket: RunContext["ticket"];
  branch: string;
  base: string;
  heads: Record<string, string>;
  openPrs: Record<string, string>;
  prRepos: string[];
}): Promise<Stop> {
  const { step, runId, ticket, branch, base, heads, openPrs, prRepos } = args;
  const held = await step.run("check-bulk-gates", async () =>
    bulkBlockers({
      base,
      labels: await ticketLabels(ticket.id),
      prs: await Promise.all(prRepos.map(async (repo) => ({ repo, state: await prState(openPrs[repo]!), judgedSha: heads[repo]! }))),
    }),
  );
  const urls = Object.values(openPrs);
  if (held.length) return stop(["Not merging into the bulk branch.", "", ...held.map((b) => `- ${b}`)].join("\n"));

  const { merged, failed } = await mergeInOrder({ step, runId, branch, order: prRepos, heads, openPrs, method: "squash" });
  const prUrls = merged.map((r) => openPrs[r]!);
  if (failed) {
    const text = partialText({ merged, failed, rest: prRepos.slice(merged.length + 1), urls: openPrs });
    return { stop: { end: { status: "failed", next: "human" }, text, record: { prUrls, error: failed.error } } };
  }
  await step.run("close-ticket", () => closeTicket(ticket.id));
  // Done frees the tickets it blocked: a comment on each brings it back to the poller, which
  // skipped it while it was blocked.
  const freed = await step.run("unblock", async () => {
    const dependents = (await blockedTickets(ticket.id)).map((d) => ({
      ...d,
      // Linear may not show this ticket done yet: it is.
      blockers: d.blockers.map((b) => (b.identifier === ticket.identifier ? { ...b, state: "done" as const } : b)),
    }));
    const free = nowUnblocked(dependents);
    for (const d of free) await comment(d.id, linearComment(`Unblocked: ${ticket.identifier} merged into \`${base}\` and is done.`, runId));
    return free.map((d) => d.identifier);
  });
  return { stop: { end: { status: "succeeded", next: "done" }, text: [bulkMergedText(prRepos, openPrs, base), freed.length ? `Unblocked ${freed.join(", ")}.` : null].filter(Boolean).join("\n\n"), record: { prUrls: urls } } };
}
