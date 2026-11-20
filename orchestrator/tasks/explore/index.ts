// `explore` checks the ticket against the code on origin/main, read-only, and ends with findings and
// a verdict. The factory posts the findings on the ticket, tagged so a later explore run and
// implement can find them, and the verdict picks the next label: an easy call queues implement.
// It gets the browser for UI claims and a short time limit. The tree of its prompt is in tasks/README.md.
import { questionReport } from "../../src/questions.ts";
import { publishEvidence } from "../../src/evidence.ts";
import { taskLabel } from "../../src/labels.ts";
import { ticketComments } from "../../src/linear.ts";
import { inlineEvidence } from "../../src/logic.ts";
import { finish, passResult, type Outcome, type Prepared, type RunContext, type Task } from "../../src/task.ts";
import { exploreResultJsonSchema, FINDINGS_TAG, handOff, parseExploreResult, verdictRetryPrompt } from "./findings.ts";
import { FINDINGS, promptVars, renderThread } from "./prompt.ts";

export const explore: Task = {
  skills: ["factory-rules", "factory-stack"],
  docs: [],
  browser: true,
  stack: true,
  branch: "none",
  timeLimitMinutes: 20,
  prepare,
};

async function prepare({ step, runId, ticket, localDir, timeLimitMinutes }: RunContext): Promise<Prepared> {
  // Oscar's comments, and the last findings if the ticket was explored before.
  const thread = await step.run("gather-thread", async () => renderThread(await ticketComments(ticket.id)));

  return {
    vars: promptVars(thread),
    outputs: { findings: FINDINGS },
    pass: {
      schema: exploreResultJsonSchema(),
      parse: (text, stderr) => parseExploreResult(text, stderr),
      retryPrompt: verdictRetryPrompt,
      needs: FINDINGS,
    },

    conclude: async ({ files, structured, passError, timedOut }: Outcome) => {
      const findings = files.findings!.trim();
      const extracted = !findings ? null : passResult(passError, () => parseExploreResult(structured));
      const verdict = extracted?.ok ? extracted.verdict : null;
      // An easy call leaves nothing for Oscar to decide.
      const questions = extracted?.ok && extracted.verdict === "human-needed" ? extracted.questions : [];
      // A run that ran out of time may have left half its findings: post them, but never chain.
      const status = timedOut ? "timed_out" : findings && verdict ? "succeeded" : "failed";

      const head = !findings
        ? timedOut
          ? `Timed out after ${timeLimitMinutes} minutes without writing findings.`
          : "Finished without writing findings."
        : timedOut
          ? `Timed out after ${timeLimitMinutes} minutes. These findings may be unfinished.`
          : verdict === "easy-call"
            ? "Explored: **easy call**."
            : verdict === "human-needed"
              ? `Explored: Answer, then add \`${taskLabel("implement")}\`.`
              : `Explored, **without a readable verdict** (${extracted && !extracted.ok ? extracted.error : "no verdict"}). Read it as needing Oscar.`;
      // Fold the findings once the cards carry what Oscar must answer, or nothing waits on him.
      const fold = !timedOut && (verdict === "easy-call" || questions.length > 0);
      const report = findings ? questionReport({ head, questions, title: "Full findings", body: findings, fold }) : head;

      // Screenshots to Linear, shown inline in the findings and the cards.
      const evidence = await step.run("publish-evidence", () => publishEvidence(localDir, report));

      await step.run("report", async () => {
        const text = inlineEvidence(report, evidence.urls);
        const error = !findings ? "The agent wrote no findings." : extracted && !extracted.ok ? `No verdict: ${extracted.error}` : null;
        await finish({
          runId,
          ticketId: ticket.id,
          end: { status, next: handOff(verdict) },
          text,
          record: error ? { error } : {},
          // Only findings are tagged: a failure note must not hide the last real findings.
          tag: findings ? FINDINGS_TAG : undefined,
        });
      });
      return { status, prUrls: [] };
    },
  };
}
