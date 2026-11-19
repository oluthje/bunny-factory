// `review` fixes what it's sure of, pushes that, posts the rest as a GitHub review and marks the PRs ready.
import { branchDiff } from "../git.ts";
import { getPrBody, markReady, postReview } from "../github.ts";
import { markForGithub, reviewComment } from "../logic.ts";
import {
  diffLines,
  extractionRetryPrompt,
  parseReviewComments,
  parseVerdict,
  placeComments,
  reviewCommentsJsonSchema,
  verdictLine,
} from "../review.ts";
import { finish, plural, prRef, REVIEW, type TaskRun } from "./shared.ts";

export const review: TaskRun = async ({ step, runId, ticket, branch, timeLimitMinutes, heads, openPrs }) => {
  // The task's `branch: "required"` means at least one repo has it.
  const repos = Object.keys(heads) as [string, ...string[]];
  const openUrls = Object.values(openPrs);

  // The review's context: the PR body, with the implementer's Decisions. Every repo's PR has the
  // same body, so the first open one will do.
  const reviewedPrBody = openUrls.length > 0 ? await step.run("fetch-pr-body", () => getPrBody(openUrls[0]!)) : null;

  return {
    prompt: { update: null, prBody: reviewedPrBody },
    outputs: { review: REVIEW },
    // The findings it left that point at a line, for inline comments.
    pass: {
      schema: reviewCommentsJsonSchema(repos),
      validate: (text, stderr) => {
        const parsed = parseReviewComments(text, repos, stderr);
        return parsed.ok ? null : parsed.error;
      },
      retryPrompt: extractionRetryPrompt,
      needs: REVIEW,
    },

    // One GitHub review per open PR, with the review as its body and the findings it left on their
    // lines; the PRs marked ready; the review in full on the ticket. Code reads the verdict; a
    // review without one is still posted for a human, but the run fails.
    conclude: async ({ files, structured, passError, timedOut, pushed, newHeads, commits }) => {
      const text = files.review!.trim();
      const verdict = text ? parseVerdict(text) : null;
      // The last attempt's error says more than a re-parse of its output would.
      const extracted = !text
        ? ({ ok: true, comments: [] } as const)
        : passError
          ? ({ ok: false, error: passError } as const)
          : parseReviewComments(structured, repos);
      const posted = await step.run("post-review", async () => {
        const urls: string[] = [];
        let placed = 0;
        let dropped = 0;
        if (!text) return { urls, placed, dropped };
        const comments = extracted.ok ? extracted.comments : [];
        const body = reviewComment(ticket, text, runId);
        for (const [repo, url] of Object.entries(openPrs)) {
          // The hunks GitHub shows on the PR, from the host's mirror, which the push updated.
          const split = placeComments(comments, repo, diffLines(await branchDiff(repo, branch)));
          for (const c of split.dropped) console.warn(`[${runId}] dropping comment on ${repo}/${c.path}:${c.line}: not in the diff`);
          const inline = split.placed.map((c) => ({ ...c, body: markForGithub(c.body) }));
          await postReview(url, newHeads[repo]!, body, inline);
          // Through automated review: a human can pick it up.
          await markReady(url);
          urls.push(url);
          placed += split.placed.length;
          dropped += split.dropped.length;
        }
        return { urls, placed, dropped };
      });
      const status = !text ? (timedOut ? "timed_out" : "failed") : verdict ? "succeeded" : "failed";
      await step.run("report", async () => {
        const errors = [
          !text ? "The agent wrote no review." : null,
          text && !verdict ? "The review has no readable verdict: each of `## Standards:` and `## Spec:` once, with PASS or CHANGES REQUESTED." : null,
          text && !extracted.ok ? `No inline comments: ${extracted.error}` : null,
        ].filter((e): e is string => e !== null);
        const where = posted.urls.length
          ? `Posted on ${posted.urls.map(prRef).join(", ")} with ${plural(posted.placed, "inline comment")}${posted.dropped ? ` (${posted.dropped} dropped: not on a line in the diff)` : ""}, and marked ready for review.`
          : "No open PR to post on.";
        const fixes = commits ? ` Pushed ${plural(commits, "fix commit")}.` : "";
        const head = verdict ? `Reviewed: ${verdictLine(verdict)}. ${where}${fixes}` : `Reviewed, **without a readable verdict**. ${where}${fixes}`;
        // The missing verdict is already in the head line.
        const notes = text && !extracted.ok ? [`⚠️ No inline comments: ${extracted.error}`] : [];
        const report = text
          ? [head, ...notes, text].join("\n\n")
          : timedOut
            ? `Timed out after ${timeLimitMinutes} minutes without writing a review.${fixes}`
            : `Finished without writing a review.${fixes}`;
        await finish(runId, ticket.id, { task: "review", status, pushed: pushed.length > 0 }, report, {
          prUrls: posted.urls,
          reviewVerdict: verdict,
          ...(errors.length ? { error: errors.join(" ") } : {}),
        });
      });
      return { status, prUrls: posted.urls };
    },
  };
};
