// `deepen-scan` scans the codebase as a whole, read-only on origin/main, for candidates:
// deepenings that would turn shallow modules into deep ones. Its ticket is filed by its clock or
// by `fac deepen` (ticket.ts), not by a human. The run ends with a candidates file and an HTML
// report; the factory files one ticket per strong candidate, up to the cap, each queued for
// deepen-refute, reports on the scan's ticket and closes it. The tree of its prompt is in
// tasks/README.md.
import { config } from "../../src/config.ts";
import { CANDIDATE_LABEL, taskLabel } from "../../src/labels.ts";
import { closeTicket, createTicket, ticketComments, ticketsWithLabel, uploadFile } from "../../src/linear.ts";
import { isFactoryComment } from "../../src/logic.ts";
import { finish, passResult, type Outcome, type Prepared, type RunContext, type Task } from "../../src/task.ts";
import { latestConclusion, recommendation } from "../deepen-refute/conclusion.ts";
import { candidateTicket, candidatesRetryPrompt, parseScanResult, renderEarlier, scanReport, scanResultJsonSchema, toFile, type Earlier } from "./candidates.ts";
import { CANDIDATES, promptVars, REPORT } from "./prompt.ts";
import { scanTicket, undecided, UNDECIDED_CAP } from "./ticket.ts";

export const deepenScan: Task = {
  skills: ["factory-rules", "improve-codebase-architecture", "codebase-design"],
  docs: [],
  browser: false,
  stack: false,
  branch: "none", // reads origin/<base>, main unless the ticket is in a bulk batch; nothing it commits is pushed
  base: null,
  timeLimitMinutes: 40,
  clock: { cron: config.deepenScanCron, ticket: clockTicket },
  onBulkParent: false,
  prepare,
};

/** The clock's throttle: no new scan while candidates pile up undecided. `fac deepen` has none. */
async function clockTicket(now: Date): Promise<{ title: string; description: string } | { skip: string }> {
  const waiting = undecided(await ticketsWithLabel(CANDIDATE_LABEL));
  if (waiting.length >= UNDECIDED_CAP) {
    return { skip: `${waiting.length} candidates wait undecided (${waiting.map((t) => t.identifier).join(", ")}); the cap is ${UNDECIDED_CAP}.` };
  }
  return scanTicket(now, config.timeZone, "");
}

/** Every candidate proposed so far, with how it fared: the scan's memory of earlier scans. */
async function earlierCandidates(): Promise<Earlier[]> {
  const tickets = await ticketsWithLabel(CANDIDATE_LABEL);
  return Promise.all(
    tickets.map(async (t) => {
      const comments = await ticketComments(t.id);
      const conclusion = latestConclusion(comments);
      const oscars = comments.filter((c) => c.isMe && !isFactoryComment(c.body));
      return {
        identifier: t.identifier,
        title: t.title,
        state: t.state,
        recommendation: conclusion ? recommendation(conclusion.body) : null,
        rejection: t.state === "cancelled" ? (oscars.at(-1)?.body ?? null) : null,
      };
    }),
  );
}

async function prepare({ step, runId, ticket, timeLimitMinutes }: RunContext): Promise<Prepared> {
  const earlier = await step.run("gather-earlier-candidates", async () => renderEarlier(await earlierCandidates()));

  return {
    vars: promptVars(earlier),
    outputs: { candidates: CANDIDATES, report: REPORT },
    pass: {
      schema: scanResultJsonSchema(),
      parse: (text, stderr) => parseScanResult(text, stderr),
      retryPrompt: candidatesRetryPrompt,
      needs: CANDIDATES,
    },

    conclude: async ({ files, structured, passError, timedOut }: Outcome) => {
      const markdown = files.candidates!.trim();
      const html = files.report!;
      const extracted = !markdown ? null : passResult(passError, () => parseScanResult(structured));
      const candidates = extracted?.ok ? extracted.candidates : null;
      // A scan that ran out of time may have left half its candidates: post them, but file no ticket.
      const status = timedOut ? "timed_out" : markdown && candidates ? "succeeded" : "failed";

      // One step per ticket: a retry after a failure files only the ones still missing.
      const filed: { identifier: string; url: string }[] = [];
      if (status === "succeeded") {
        for (const [i, candidate] of toFile(candidates!).entries()) {
          filed.push(
            await step.run(`file-candidate-${i}`, () =>
              createTicket({ ...candidateTicket(candidate, ticket), labels: [CANDIDATE_LABEL, taskLabel("deepen-refute")] }),
            ),
          );
        }
      }

      // The report is for Oscar's eyes and for debugging: a failed upload costs the link only.
      const reportUrl = !html.trim()
        ? null
        : await step.run("upload-report", () =>
            uploadFile(Buffer.from(html), `${ticket.identifier}-scan-report.html`, "text/html").catch(() => null),
          );

      await step.run("report", async () => {
        const link = reportUrl ? `\n\n[📄 The report (HTML)](${reportUrl})` : "";
        const text = !markdown
          ? timedOut
            ? `Timed out after ${timeLimitMinutes} minutes without writing candidates.`
            : "Finished without writing candidates."
          : timedOut
            ? `Timed out after ${timeLimitMinutes} minutes. These candidates may be unfinished, so no ticket was filed.${link}\n\n${markdown}`
            : candidates
              ? scanReport({ candidates, filed, reportUrl, markdown })
              : `Scanned, **without readable candidates** (${extracted && !extracted.ok ? extracted.error : "none"}), so no ticket was filed.${link}\n\n${markdown}`;
        const error = !markdown ? "The agent wrote no candidates." : extracted && !extracted.ok ? `No candidates: ${extracted.error}` : null;
        await finish({ runId, ticketId: ticket.id, end: { status, next: "done" }, text, record: error ? { error } : {} });
      });
      // Nothing on the scan's ticket waits on anyone: the decisions live on the candidates' tickets.
      if (status === "succeeded") await step.run("close-ticket", () => closeTicket(ticket.id));
      return { status, prUrls: [] };
    },
  };
}
