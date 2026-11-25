// `qa` walks the flows of one QA scope (its ticket) on the branch its `**Branch:**` line names, with
// the stack and the browser, and hunts the release changes for suspects. Nothing is pushed. The
// factory posts one comment per new defect and the coverage summary on the ticket, replies on each
// known defect the run checked again, and the ticket waits on Oscar. The tree of its prompt is in
// tasks/README.md; the design is docs/qa-design.md.
import { config } from "../../src/config.ts";
import { uploadEvidence } from "../../src/evidence.ts";
import { commitsBetween } from "../../src/git.ts";
import { QA_DEFECTS_LABEL } from "../../src/labels.ts";
import { applyLabels, openTicketsWithLabel, postComment, ticketsWithLabel, ticketThreads } from "../../src/linear.ts";
import { linearComment } from "../../src/logic.ts";
import { skillSection } from "../../src/prompt.ts";
import { finish, passResult, type Outcome, type Prepared, type RunContext, type Task } from "../../src/task.ts";
import { bugDefect, DEFECT_TAG, type KnownDefect, nextDefectNumber, openDefects, RECHECK_TAG, renderKnownDefects } from "./defects.ts";
import { FINDINGS, promptVars } from "./prompt.ts";
import { MAX_COMMITS, RELEASED, renderReleaseChanges, type RepoChanges } from "./release.ts";
import { COVERAGE_TAG, type DefectLinks, noLongerReproduces, renderCoverage, renderDefect, stillReproduces, testedOn } from "./report.ts";
import { parseQaResult, qaResultJsonSchema, qaRetryPrompt } from "./result.ts";
import { branchOf } from "./scope.ts";

/** The label on the team's bug tickets: open ones are known defects. */
const BUG_LABEL = "Type: Bug";
/** The most bug tickets a run gets, newest first. */
const MAX_BUGS = 100;

export const qa: Task = {
  skills: ["factory-rules", "factory-stack"],
  docs: [],
  browser: true,
  stack: true,
  branch: "none", // tests origin/<base>; nothing it commits is pushed
  base: (ticket) => branchOf(ticket.description), // none: main
  timeLimitMinutes: 60,
  clock: null,
  onBulkParent: false,
  prepare,
};

async function prepare({ step, runId, ticket, base, localDir, timeLimitMinutes, baseShas }: RunContext): Promise<Prepared> {
  // What the branch adds to production, per repo: where the code hunt starts.
  const releaseChanges: RepoChanges[] = await step.run("gather-release-changes", async (): Promise<RepoChanges[]> =>
    base === RELEASED
      ? []
      : Promise.all(config.repos.map(async (repo) => ({ repo, changes: await commitsBetween(repo, RELEASED, base, MAX_COMMITS) }))),
  );

  // Open bug tickets, and the defects earlier QA runs posted that still reproduced.
  const { known, nextNumber } = await step.run("gather-known-defects", async () => {
    const posted: KnownDefect[] = [];
    for (const t of await ticketsWithLabel(QA_DEFECTS_LABEL)) {
      if (t.state === "cancelled") continue;
      posted.push(...openDefects(t, await ticketThreads(t.id)));
    }
    const bugs = (await openTicketsWithLabel(BUG_LABEL, MAX_BUGS)).map(bugDefect);
    return { known: [...posted, ...bugs], nextNumber: nextDefectNumber(await ticketThreads(ticket.id)) };
  });
  const knownByRef = new Map(known.map((k) => [k.ref, k]));
  // Read in a step: a replay after a deploy that edits the skill keeps the prompt the run started with.
  const runnerGaps = await step.run("read-runner-gaps", () => skillSection("factory-stack", "Runner gaps"));

  return {
    vars: promptVars({
      releaseChanges: renderReleaseChanges(base, releaseChanges),
      knownDefects: renderKnownDefects(known),
      runnerGaps,
    }),
    outputs: { findings: FINDINGS },
    pass: {
      schema: qaResultJsonSchema(),
      parse: (text, stderr) => parseQaResult(text, new Set(knownByRef.keys()), stderr),
      retryPrompt: qaRetryPrompt,
      needs: FINDINGS,
    },

    conclude: async ({ files, structured, passError, timedOut }: Outcome) => {
      const findings = files.findings!.trim();
      const extracted = !findings ? null : passResult(passError, () => parseQaResult(structured, new Set(knownByRef.keys())));
      const result = extracted?.ok ? extracted.result : null;
      // A run that ran out of time still posts what it found: its unreached flows say how far it got.
      const status = timedOut ? "timed_out" : result ? "succeeded" : "failed";
      const tested = testedOn(base, baseShas);

      let coverage: string | null = null;
      if (result) {
        const evidence = [...result.flows, ...result.defects].flatMap((x) => x.evidence.map((e) => e.file));
        const uploads = await step.run("upload-evidence", () => uploadEvidence(localDir, evidence));

        // A new defect gets its own comment; a known one that reproduced, a reply where it lives.
        const defectLinks: DefectLinks = [];
        let number = nextNumber;
        for (const [i, d] of result.defects.entries()) {
          const match = d.knownAs ? knownByRef.get(d.knownAs)! : null;
          if (match) {
            await step.run(`recheck-defect-${i}`, () =>
              postComment(match.ticketId, linearComment(stillReproduces(d, tested, uploads), runId, RECHECK_TAG), match.commentId ?? undefined),
            );
            defectLinks.push({ label: match.ref, url: match.url });
          } else {
            const n = number++;
            const posted = await step.run(`post-defect-${i}`, () => postComment(ticket.id, linearComment(renderDefect(n, d, uploads), runId, DEFECT_TAG)));
            defectLinks.push({ label: `QA-${n}`, url: posted.url });
          }
        }
        // A known defect whose steps passed: fixed, or it didn't reproduce.
        for (const [i, f] of result.flows.entries()) {
          const match = f.knownAs ? knownByRef.get(f.knownAs)! : null;
          if (!match) continue;
          await step.run(`recheck-flow-${i}`, () =>
            postComment(match.ticketId, linearComment(noLongerReproduces(f, tested, uploads), runId, RECHECK_TAG), match.commentId ?? undefined),
          );
        }
        // Later QA runs find this ticket's defects by the flag.
        if (number > nextNumber) await step.run("flag-defects", () => applyLabels(ticket.id, { add: [QA_DEFECTS_LABEL], remove: [] }));
        coverage = renderCoverage({ result, defectLinks, uploads, branch: base, shas: baseShas });
      }

      await step.run("report", async () => {
        const head = !findings
          ? timedOut
            ? `Timed out after ${timeLimitMinutes} minutes without writing findings.`
            : "Finished without writing findings."
          : !result
            ? `QA'd, **without a readable coverage** (${extracted && !extracted.ok ? extracted.error : "no coverage"}). Nothing was posted from it; the findings are below.`
            : timedOut
              ? `Timed out after ${timeLimitMinutes} minutes: the flows not reached say how far it got.`
              : null;
        const body = coverage ?? (findings ? `+++ Findings\n\n${findings}\n\n+++` : "");
        const text = [head, body].filter(Boolean).join("\n\n");
        const error = !findings ? "The agent wrote no findings." : !result ? `No coverage: ${extracted && !extracted.ok ? extracted.error : "none"}` : null;
        await finish({
          runId,
          ticketId: ticket.id,
          end: { status, next: "human" },
          text,
          record: error ? { error } : {},
          // Only a real coverage summary is tagged: a failure note must not hide the last one.
          tag: coverage ? COVERAGE_TAG : undefined,
        });
      });
      return { status, prUrls: [] };
    },
  };
}
