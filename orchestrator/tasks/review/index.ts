// `review` checks out the ticket's branch, fixes what it's sure of and commits that, and ends with a
// review file; the factory pushes the fixes, posts the rest as a GitHub review and marks the PRs
// ready. It runs specs, so it gets `factory-stack`, but no browser or evidence. Then the
// ticket waits on Oscar. The tree of its prompt is in tasks/README.md.
import { questionReport } from "../../src/questions.ts";
import { branchDiff } from "../../src/git.ts";
import { getPrBody, markReady, postReview } from "../../src/github.ts";
import { markForGithub } from "../../src/logic.ts";
import { finish, passResult, plural, prRef, type Outcome, type Prepared, type RunContext, type Task } from "../../src/task.ts";
import { promptVars, REVIEW } from "./prompt.ts";
import {
  diffLines,
  extractionRetryPrompt,
  parseReviewExtraction,
  parseVerdict,
  placeComments,
  reviewComment,
  reviewExtractionJsonSchema,
  verdictLine,
} from "./review.ts";

export const review: Task = {
  skills: ["factory-rules", "factory-stack", "code-review"],
  docs: [],
  browser: false,
  stack: true,
  branch: "required",
  timeLimitMinutes: null,
  prepare,
};

async function prepare({ step, runId, ticket, branch, timeLimitMinutes, heads, openPrs }: RunContext): Promise<Prepared> {
  // The task's `branch: "required"` means at least one repo has it.
  const repos = Object.keys(heads) as [string, ...string[]];
  const openUrls = Object.values(openPrs);

  // The review's context: the PR body, with the implementer's Decisions. Every repo's PR has the
  // same body, so the first open one will do.
  const reviewedPrBody = openUrls.length > 0 ? await step.run("fetch-pr-body", () => getPrBody(openUrls[0]!)) : null;

  return {
    vars: promptVars(reviewedPrBody),
    outputs: { review: REVIEW },
    // The findings it left that point at a line, for inline comments.
    pass: {
      schema: reviewExtractionJsonSchema(repos),
      parse: (text, stderr) => parseReviewExtraction(text, repos, stderr),
      retryPrompt: extractionRetryPrompt,
      needs: REVIEW,
    },

    // One GitHub review per open PR, with the review as its body and the findings it left on their
    // lines; the PRs marked ready; on the ticket, only a line pointing at the PRs, so nothing on
    // the ticket repeats the PR. With no PR to post on, the ticket gets the question cards and the
    // review instead. Code reads the verdict; a review without one is still posted for a human, but
    // the run fails.
    conclude: async ({ files, structured, passError, timedOut, newHeads, commits }: Outcome) => {
      const text = files.review!.trim();
      const verdict = text ? parseVerdict(text) : null;
      const extracted = !text ? ({ ok: true, comments: [], questions: [] } as const) : passResult(passError, () => parseReviewExtraction(structured, repos));
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
          text && !extracted.ok ? `No inline comments or questions: ${extracted.error}` : null,
        ].filter((e): e is string => e !== null);
        const where = posted.urls.length
          ? `Posted on ${posted.urls.map(prRef).join(", ")} with ${plural(posted.placed, "inline comment")}${posted.dropped ? ` (${posted.dropped} dropped: not on a line in the diff)` : ""}, and marked ready for review.`
          : "No open PR to post on.";
        const fixes = commits ? ` Pushed ${plural(commits, "fix commit")}.` : "";
        const head = verdict ? `Reviewed: ${verdictLine(verdict)}. ${where}${fixes}` : `Reviewed, **without a readable verdict**. ${where}${fixes}`;
        // The missing verdict is already in the head line.
        const notes = text && !extracted.ok ? [`⚠️ No inline comments or questions: ${extracted.error}`] : [];
        // Posted: the review and its decisions are on the PR, so the ticket only points there.
        // Not posted: the ticket is the only place left, so it gets the cards and the folded review.
        const report = text
          ? posted.urls.length
            ? [head, ...notes].join("\n\n")
            : questionReport({
                head: [head, ...notes].join("\n\n"),
                questions: extracted.ok ? extracted.questions : [],
                title: "Full review",
                body: text,
                fold: extracted.ok,
              })
          : timedOut
            ? `Timed out after ${timeLimitMinutes} minutes without writing a review.${fixes}`
            : `Finished without writing a review.${fixes}`;
        // The chain ends here: a reviewed PR waits on Oscar.
        await finish({
          runId,
          ticketId: ticket.id,
          end: { status, next: "human" },
          text: report,
          record: { prUrls: posted.urls, reviewVerdict: verdict, ...(errors.length ? { error: errors.join(" ") } : {}) },
        });
      });
      return { status, prUrls: posted.urls };
    },
  };
}
