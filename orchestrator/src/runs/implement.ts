// `implement` creates or updates: with no branch on GitHub it branches from main and opens draft PRs;
// with one, it builds on the branch with Oscar's feedback and replies on Oscar's review threads.
import { config } from "../config.ts";
import { lastFinishedAt } from "../db/index.ts";
import { publishEvidence } from "../evidence.ts";
import { renderFeedback } from "../feedback.ts";
import { openOrFindPr, prComments, replyToThread, reviewThreads, setPrBody, viewerLogin } from "../github.ts";
import { ticketComments } from "../linear.ts";
import { linkEvidence, prBody, prTitle } from "../logic.ts";
import { parseThreadReplies, replyBody, replyRetryPrompt, threadRepliesJsonSchema } from "../replies.ts";
import { finish, plural, PR_BODY, prRef, type TaskRun } from "./shared.ts";

export const implement: TaskRun = async ({ step, runId, ticket, branch, localDir, timeLimitMinutes, heads, openPrs }) => {
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

  return {
    prompt: { update: feedback ? { feedback: feedback.markdown } : null, prBody: null },
    outputs: { prBody: PR_BODY },
    // One reply per review thread the update was given.
    pass:
      handles.length > 0
        ? {
            schema: threadRepliesJsonSchema(handles),
            validate: (text, stderr) => {
              const parsed = parseThreadReplies(text, handles, stderr);
              return parsed.ok ? null : parsed.error;
            },
            retryPrompt: replyRetryPrompt,
          }
        : null,

    conclude: async ({ files, structured, passError, timedOut, pushed, commits }) => {
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
            opened.push(await openOrFindPr(repo, branch, prTitle(ticket), body));
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
        await finish(runId, ticket.id, { task: "implement", status, pushed: pushed.length > 0 }, lines.join("\n\n"), { prUrls });
      });
      return { status, prUrls };
    },
  };
};
