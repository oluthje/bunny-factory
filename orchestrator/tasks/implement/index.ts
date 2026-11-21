// `implement` creates or updates: with no branch on GitHub it branches from the run's base (main, or
// a bulk branch) and opens draft PRs into it;
// with one, it builds on the branch with Oscar's feedback and replies on Oscar's review threads.
// It reviews and fixes its own work with `code-review`, and ends with commits and a PR body.
// The tree of its prompt is in tasks/README.md.
import { config } from "../../src/config.ts";
import { lastFinishedAt } from "../../src/db/index.ts";
import { publishEvidence } from "../../src/evidence.ts";
import { openOrFindPr, prComments, replyToThread, reviewThreads, setPrBody, viewerLogin } from "../../src/github.ts";
import { ticketComments } from "../../src/linear.ts";
import { linkEvidence } from "../../src/logic.ts";
import { finish, plural, prRef, type Outcome, type Prepared, type RunContext, type Task } from "../../src/task.ts";
import { renderFeedback } from "./feedback.ts";
import { prBody, prTitle } from "./pr.ts";
import { PR_BODY, promptVars, renderThread } from "./prompt.ts";
import { parseThreadReplies, replyBody, replyRetryPrompt, threadRepliesJsonSchema } from "./replies.ts";

export const implement: Task = {
  skills: [
    "factory-rules",
    "factory-stack",
    "factory-evidence",
    "implement",
    "tdd", // called by implement
    "codebase-design", // called by tdd
    "code-review",
    "pr",
  ],
  docs: ["pr-guide.md"], // read at step 7, with the pr skill
  browser: true,
  stack: true,
  branch: "optional",
  timeLimitMinutes: null,
  clock: null,
  onBulkParent: true, // fixes the PR from a bulk parent's branch into main
  prepare,
};

async function prepare({ step, runId, ticket, branch, base, localDir, timeLimitMinutes, heads, openPrs }: RunContext): Promise<Prepared> {
  const openUrls = Object.values(openPrs);

  // An update's feedback, acted on with the ticket still the spec: Oscar's review threads waiting
  // on the factory, PR comments and ticket comments. "New" means since the ticket's previous run finished.
  const updating = Object.keys(heads).length > 0;
  const feedback = updating
    ? await step.run("gather-feedback", async () => {
        return renderFeedback({
          threads: (await Promise.all(openUrls.map(reviewThreads))).flat(),
          prComments: (await Promise.all(openUrls.map(prComments))).flat(),
          ticketComments: await ticketComments(ticket.id),
          since: lastFinishedAt(ticket.id, runId),
          viewer: await viewerLogin(),
        });
      })
    : null;
  const handles = Object.keys(feedback?.handles ?? {}) as [string, ...string[]];

  // A create's context: Oscar's ticket comments, and the latest explore findings if the ticket was
  // explored. An update's feedback already has the ticket comments, and skips the factory's own.
  // The step keeps its old id: its return is still a string (coding standards, rule 9).
  const thread = updating ? "" : await step.run("gather-findings", async () => renderThread(await ticketComments(ticket.id)));

  return {
    vars: promptVars({ feedback: feedback?.markdown ?? null, thread, base }),
    outputs: { prBody: PR_BODY },
    // One reply per review thread the update was given.
    pass:
      handles.length > 0
        ? {
            schema: threadRepliesJsonSchema(handles),
            parse: (text: string, stderr: string) => parseThreadReplies(text, handles, stderr),
            retryPrompt: replyRetryPrompt,
          }
        : null,

    conclude: async ({ files, structured, passError, timedOut, pushed, commits }: Outcome) => {
      // Evidence to Linear: inline on the ticket, linked from the PR (GitHub can't show it inline).
      const evidence = await step.run("publish-evidence", () => publishEvidence(localDir, files.prBody!));
      const agentBody = linkEvidence(files.prBody!, evidence.urls);

      // PRs: a draft for each repo the run pushed to that has none, and the body replaced on the open ones.
      const prs = await step.run("open-or-update-prs", async () => {
        const opened: string[] = [];
        const updated: string[] = [];
        const body = prBody(ticket, agentBody, runId);
        for (const repo of config.repos) {
          const open = openPrs[repo];
          if (open) {
            if (files.prBody!.trim()) await setPrBody(open, body);
            updated.push(open);
          } else if (pushed.includes(repo)) {
            opened.push(await openOrFindPr(repo, branch, prTitle(ticket), body, base));
          }
        }
        return { opened, updated };
      });
      const prUrls = [...prs.opened, ...prs.updated];

      // Replies on the review threads the update was given, as the factory.
      const replied = await step.run("post-replies", async () => {
        if (!feedback || handles.length === 0 || passError) return 0;
        const parsed = parseThreadReplies(structured, handles);
        if (!parsed.ok) return 0;
        for (const r of parsed.replies) await replyToThread(feedback.handles[r.thread]!, replyBody(r, runId));
        return parsed.replies.length;
      });

      // Report back on the ticket, with the evidence inline, and hand off.
      const status = pushed.length > 0 ? "succeeded" : timedOut ? "timed_out" : "no_changes";
      await step.run("report", async () => {
        const lines = [
          prs.opened.length ? `Opened ${prs.opened.map(prRef).join(", ")} as ${config.draftPrs ? "drafts" : "PRs"}.` : null,
          prs.updated.length ? `Updated ${prs.updated.map(prRef).join(", ")}.` : null,
          commits ? `Pushed ${plural(commits, "commit")}.` : null,
          handles.length ? `Replied on ${replied} of ${plural(handles.length, "review thread")}.` : null,
          passError ? `⚠️ No thread replies: ${passError}` : null,
          pushed.length === 0
            ? timedOut
              ? `Timed out after ${timeLimitMinutes} minutes with no commits.`
              : "Finished without committing any changes."
            : null,
          // With PRs, the body lives there; without, it explains what happened.
          prUrls.length > 0 ? null : agentBody.trim(),
          evidence.linearMarkdown,
        ].filter((l): l is string => Boolean(l));
        // New commits always get a review, whether they opened the PR or updated it.
        await finish({ runId, ticketId: ticket.id, end: { status, next: pushed.length > 0 ? "review" : "human" }, text: lines.join("\n\n"), record: { prUrls } });
      });
      return { status, prUrls };
    },
  };
}
