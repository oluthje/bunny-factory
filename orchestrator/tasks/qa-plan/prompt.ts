// qa-plan's placeholders in prompt.md: where to write the proposals, how big a QA scope may be (from
// tasks/qa/scope.ts, qa's contract), what prepare gathered (the
// release changes, the known defects, the runner gaps), and the ticket's thread so far: the last
// proposals, Oscar's replies to them and the QA scopes already filed. Pure: no I/O, so it is
// unit-tested in prompt.test.ts.
import { dated, type TicketComment } from "../../src/comments.ts";
import { commentText } from "../../src/logic.ts";
import { artifact } from "../../src/runner-paths.ts";
import { FLOW_MINUTES, QA_TIME_LIMIT_MINUTES, SCOPE_BUDGET_MINUTES } from "../qa/scope.ts";
import { latestProposals } from "./proposals.ts";

/** Where the agent writes its proposals: the run's own record, and what the structured pass reads. */
export const PROPOSALS = artifact("qa-proposals.md");

/** The last proposals and Oscar's replies to them, and the QA scopes filed so far. */
export function renderThread(comments: readonly TicketComment[], filed: readonly { identifier: string; title: string; state: string }[]): string {
  const latest = latestProposals(comments);
  if (!latest) return "## Earlier proposals\n\nNone: this is the first run. Propose, and accept nothing.";
  const sections = [
    `## Earlier proposals\n\nThe last proposals. Revise them as Oscar's replies ask: keep each QA scope's number, mark accepted every one he accepted, leave out every one he dropped, and leave the ones he didn't mention as proposals.\n\n<proposals date="${latest.proposals.createdAt.slice(0, 10)}">\n${commentText(latest.proposals.body)}\n</proposals>`,
    `## Oscar's replies\n\nOldest first, every one since the first proposals: what he accepted in an earlier round still holds.\n\n${latest.replies.length ? latest.replies.map((c) => dated(c)).join("\n\n") : "None yet."}`,
    `## Filed QA scopes\n\nFiled as sub-tickets, cancelled ones too: each lives on its ticket now, and is never filed again. Keep each in the proposals unchanged, under the same number and area; a change Oscar asks of one is his to make on its ticket.\n\n${filed.length ? filed.map((f) => `- ${f.identifier}: ${f.title}${f.state === "cancelled" ? " (cancelled)" : ""}`).join("\n") : "None yet."}`,
  ];
  return sections.join("\n\n");
}

export function promptVars(args: { thread: string; releaseChanges: string; knownDefects: string; runnerGaps: string }): Record<string, string> {
  return {
    proposalsPath: PROPOSALS,
    qaTimeLimit: String(QA_TIME_LIMIT_MINUTES),
    uiMinutes: String(FLOW_MINUTES.UI),
    apiMinutes: String(FLOW_MINUTES.API),
    scopeBudget: String(SCOPE_BUDGET_MINUTES),
    maxUiFlows: String(Math.floor(SCOPE_BUDGET_MINUTES / FLOW_MINUTES.UI)),
    ...args,
  };
}
