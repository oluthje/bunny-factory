// `qa-plan` splits QA of a branch, named by its ticket's `**Branch:**` line, into QA scopes, one
// product area each, reading code only. A first run proposes them and waits on Oscar; a later run
// revises them as his replies ask, and the factory files each one he accepted as a sub-ticket
// labelled `oscar-factory:qa`, which starts its run. It watches the QA scopes it filed: once every
// one has finished, it posts the QA verdict on its ticket, and again whenever the verdict changes.
// The tree of its prompt is in tasks/README.md; the design is docs/qa-design.md.
import { config } from "../../src/config.ts";
import { commitsBetween } from "../../src/git.ts";
import { IN_PROGRESS_LABEL, QA_DEFECTS_LABEL, QA_RELEASE_LABEL, taskLabel } from "../../src/labels.ts";
import { applyLabels, createTicket, openTicketsWithLabel, postComment, subTickets, ticketComments, ticketsWithLabel, ticketThreads } from "../../src/linear.ts";
import { commentText, hasCommentTag, linearComment } from "../../src/logic.ts";
import { skillSection } from "../../src/prompt.ts";
import { finish, passResult, type Outcome, type Prepared, type RunContext, type Task, type Watch } from "../../src/task.ts";
import { BUG_LABEL, bugDefect, type KnownDefect, MAX_BUGS, openDefects, renderKnownDefects } from "../qa/defects.ts";
import { MAX_COMMITS, RELEASED, renderReleaseChanges, type RepoChanges } from "../qa/release.ts";
import { defectTicketOf } from "../qa/defects.ts";
import { branchOf, scopeTitle } from "../qa/scope.ts";
import { type Counted, fingerprintOf, knownCounted, lastRunCoverage, perScope, postedDefects, renderVerdict, type ScopeState, VERDICT_TAG } from "./verdict.ts";
import { PROPOSALS, promptVars, renderThread } from "./prompt.ts";
import { type Filed, filedByArea, needsHumanOf, oscarReplied, parseProposals, PROPOSALS_TAG, proposalsJsonSchema, proposalsRetryPrompt, renderProposals, scopeDescription, toFile } from "./proposals.ts";

export const qaPlan: Task = {
  skills: ["factory-rules"],
  docs: [],
  browser: false,
  stack: false,
  branch: "none", // reads origin/<base>; nothing it commits is pushed
  base: (ticket) => branchOf(ticket.description), // none: main
  timeLimitMinutes: 30,
  clock: null,
  onBulkParent: false,
  prepare,
  // The QA verdict: a sub-ticket's run ending, a regrade or a duplicate mark brings it here.
  watch: { flag: QA_RELEASE_LABEL, changed: postVerdict },
};

/** A filed QA scope: a sub-ticket titled as one, and not cancelled. */
const isQaScope = (t: { title: string; state: string }) => t.title.startsWith(scopeTitle("")) && t.state !== "cancelled";

/**
 * Once every filed QA scope has finished (its coverage posted, and no qa run queued or working),
 * posts the QA verdict on the qa-plan ticket, unless the last one says the same.
 */
async function postVerdict({ step, parent }: Parameters<Watch["changed"]>[0]): Promise<unknown> {
  const gathered = await step.run("gather-qa-scopes", async () => {
    const scopes: ScopeState[] = [];
    const defects: Counted[] = [];
    for (const t of (await subTickets(parent.id)).filter(isQaScope)) {
      const comments = await ticketThreads(t.id);
      const coverage = lastRunCoverage(comments);
      const queued = t.labels.includes(taskLabel("qa")) || t.labels.includes(IN_PROGRESS_LABEL);
      scopes.push({ identifier: t.identifier, title: t.title, url: t.url, finished: coverage !== null && !queued, coverage });
      const known: Counted[] = [];
      for (const k of coverage?.known ?? []) {
        // A QA defect's own thread holds Oscar's regrade of it; a bug ticket has none.
        const at = defectTicketOf(k.ref);
        const thread = at === t.identifier ? comments : at ? await ticketThreads(at) : null;
        known.push(knownCounted(k, t.identifier, at && thread ? { identifier: at, comments: thread } : null));
      }
      defects.push(...perScope(postedDefects(t, t.identifier, comments), known));
    }
    return { scopes, defects };
  });
  const waiting = gathered.scopes.filter((s) => !s.finished).map((s) => s.identifier);
  if (!gathered.scopes.length || waiting.length) return { posted: false, waiting };

  return step.run("post-verdict", async () => {
    const comments = await ticketComments(parent.id);
    const proposals = comments.findLast((c) => hasCommentTag(c.body, PROPOSALS_TAG));
    const text = renderVerdict({ ...gathered, needsHuman: proposals ? needsHumanOf(commentText(proposals.body)) : [] });
    const last = comments.findLast((c) => hasCommentTag(c.body, VERDICT_TAG));
    if (last && fingerprintOf(commentText(last.body)) === fingerprintOf(text)) return { posted: false, unchanged: true };
    await postComment(parent.id, linearComment(text, null, VERDICT_TAG));
    return { posted: true };
  });
}

async function prepare({ step, runId, ticket, base, timeLimitMinutes }: RunContext): Promise<Prepared> {
  const releaseChanges: RepoChanges[] = await step.run("gather-release-changes", async (): Promise<RepoChanges[]> =>
    base === RELEASED ? [] : Promise.all(config.repos.map(async (repo) => ({ repo, changes: await commitsBetween(repo, RELEASED, base, MAX_COMMITS) }))),
  );

  // The same known defects a qa run gets: open bug tickets, and QA defects no run has found gone.
  const known: KnownDefect[] = await step.run("gather-known-defects", async () => {
    const posted: KnownDefect[] = [];
    for (const t of await ticketsWithLabel(QA_DEFECTS_LABEL)) {
      if (t.state === "cancelled") continue;
      posted.push(...openDefects(t, await ticketThreads(t.id)));
    }
    return [...posted, ...(await openTicketsWithLabel(BUG_LABEL, MAX_BUGS)).map(bugDefect)];
  });

  // The last proposals, Oscar's replies, and what's filed already.
  const { thread, replied } = await step.run("gather-thread", async () => {
    const comments = await ticketComments(ticket.id);
    return { thread: renderThread(comments, await subTickets(ticket.id)), replied: oscarReplied(comments) };
  });
  const runnerGaps = await step.run("read-runner-gaps", () => skillSection("factory-stack", "Runner gaps"));

  return {
    vars: promptVars({ thread, releaseChanges: renderReleaseChanges(base, releaseChanges), knownDefects: renderKnownDefects(known), runnerGaps }),
    outputs: { proposals: PROPOSALS },
    pass: {
      schema: proposalsJsonSchema(),
      parse: (text, stderr) => parseProposals(text, replied, stderr),
      retryPrompt: proposalsRetryPrompt,
      needs: PROPOSALS,
    },

    conclude: async ({ files, structured, passError, timedOut }: Outcome) => {
      const written = files.proposals!.trim();
      const extracted = !written ? null : passResult(passError, () => parseProposals(structured, replied));
      const proposals = extracted?.ok ? extracted.proposals : null;
      // A run that ran out of time may have left half its proposals: post them, file nothing.
      const status = timedOut ? "timed_out" : proposals ? "succeeded" : "failed";

      let text: string;
      if (proposals && !timedOut) {
        // What's filed already, read again: Oscar may have filed or cancelled one meanwhile. A filed
        // QA scope, cancelled or not, is never filed again.
        const filed: Filed = await step.run("read-filed", async () => filedByArea(proposals, await subTickets(ticket.id)));

        // Each one filed already labelled, so its run starts: its description names the QA scopes
        // filed before it by ticket, and the rest by title.
        for (const s of toFile(proposals, filed)) {
          const t = await step.run(`file-scope-${s.number}`, () =>
            createTicket({ title: scopeTitle(s.area), description: scopeDescription(s, proposals, base, filed), labels: [taskLabel("qa")], parentId: ticket.id }),
          );
          filed[s.area.toLowerCase()] = { ...t, cancelled: false };
        }
        // The QA verdict finds the release by its flag.
        if (Object.keys(filed).length) await step.run("flag-release", () => applyLabels(ticket.id, { add: [QA_RELEASE_LABEL], remove: [] }));
        text = renderProposals(proposals, base, filed, written);
      } else {
        const why = !written ? "without writing proposals" : !proposals ? `without readable proposals (${extracted && !extracted.ok ? extracted.error : "none"})` : "";
        const head = timedOut ? `Timed out after ${timeLimitMinutes} minutes${why ? ` ${why}` : ""}. Nothing was filed.` : `Finished ${why}. Nothing was filed.`;
        text = written ? `${head}\n\n+++ Proposals\n\n${written}\n\n+++` : head;
      }

      await step.run("report", () =>
        finish({
          runId,
          ticketId: ticket.id,
          end: { status, next: "human" },
          text,
          record: proposals ? {} : { error: !written ? "The agent wrote no proposals." : "No readable proposals." },
          // Only real proposals are tagged: a failure note must not hide the last ones.
          tag: proposals && !timedOut ? PROPOSALS_TAG : undefined,
        }),
      );
      return { status, prUrls: [] };
    },
  };
}
