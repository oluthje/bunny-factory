// `deepen-refute` argues against one candidate, the deepening its ticket describes, read-only on
// origin/main, and ends with a conclusion: the case for, the case against, the cost, and a
// verdict of `do it`, `don't` or `not yet`. The factory posts it on the ticket, tagged so a later
// deepen-refute run and deepen-scan can find it, with the agent's HTML report linked above it.
// Whatever the verdict, the ticket then waits on Oscar: the decision is his. The tree of its
// prompt is in tasks/README.md.
import { ticketComments, uploadFile } from "../../src/linear.ts";
import { finish, passResult, type Outcome, type Prepared, type RunContext, type Task } from "../../src/task.ts";
import { CONCLUSION_TAG, conclusionReport, parseRefuteResult, refuteResultJsonSchema, VERDICT_WORDS, verdictRetryPrompt } from "./conclusion.ts";
import { CONCLUSION, promptVars, renderThread, REPORT } from "./prompt.ts";

export const deepenRefute: Task = {
  skills: ["factory-rules", "codebase-design", "improve-codebase-architecture"],
  docs: ["method.md"], // read at step 3
  browser: false,
  stack: false,
  branch: "none", // reads origin/main; nothing it commits is pushed
  timeLimitMinutes: 20,
  clock: null,
  prepare,
};

async function prepare({ step, runId, ticket, timeLimitMinutes }: RunContext): Promise<Prepared> {
  // The last conclusion if the candidate was refuted before, and Oscar's comments.
  const thread = await step.run("gather-thread", async () => renderThread(await ticketComments(ticket.id)));

  return {
    vars: promptVars(thread),
    outputs: { conclusion: CONCLUSION, report: REPORT },
    pass: {
      schema: refuteResultJsonSchema(),
      parse: (text, stderr) => parseRefuteResult(text, stderr),
      retryPrompt: verdictRetryPrompt,
      needs: CONCLUSION,
    },

    conclude: async ({ files, structured, passError, timedOut }: Outcome) => {
      const conclusion = files.conclusion!.trim();
      const html = files.report!;
      const extracted = !conclusion ? null : passResult(passError, () => parseRefuteResult(structured));
      const result = extracted?.ok ? extracted : null;
      // A run that ran out of time may have left half a conclusion: post it, but as a failure.
      const status = timedOut ? "timed_out" : conclusion && result ? "succeeded" : "failed";

      const head = !conclusion
        ? timedOut
          ? `Timed out after ${timeLimitMinutes} minutes without writing a conclusion.`
          : "Finished without writing a conclusion."
        : timedOut
          ? `Timed out after ${timeLimitMinutes} minutes. This conclusion may be unfinished.`
          : result
            ? `Refuted: **${VERDICT_WORDS[result.verdict]}**.`
            : `Refuted, **without a readable verdict** (${extracted && !extracted.ok ? extracted.error : "no verdict"}). Read the conclusion for it.`;

      // The report is for Oscar's eyes only: a failed upload costs the link, never the conclusion.
      const reportUrl = !html.trim()
        ? null
        : await step.run("upload-report", () =>
            uploadFile(Buffer.from(html), `${ticket.identifier}-refute-report.html`, "text/html").catch(() => null),
          );

      await step.run("report", async () => {
        const text = conclusion
          ? conclusionReport({ head, reportUrl, summary: result?.summary ?? "", identifier: ticket.identifier, conclusion })
          : head;
        const error = !conclusion ? "The agent wrote no conclusion." : extracted && !extracted.ok ? `No verdict: ${extracted.error}` : null;
        await finish({
          runId,
          ticketId: ticket.id,
          end: { status, next: "human" },
          text,
          record: error ? { error } : {},
          // Only a conclusion is tagged: a failure note must not hide the last real one.
          tag: conclusion ? CONCLUSION_TAG : undefined,
        });
      });
      return { status, prUrls: [] };
    },
  };
}
