// implement's placeholders in prompt.md: create or update mode, an update's feedback, a create's
// thread (Oscar's ticket comments and any explore findings), and where to write the PR body.
// Pure: no I/O, so it is unit-tested in prompt.test.ts.
import { dated, type TicketComment } from "../../src/comments.ts";
import { artifact } from "../../src/runner-paths.ts";
import { findingsBlock, isOscars, latestFindings } from "../explore/findings.ts";

/** Where the agent writes the PR body. */
export const PR_BODY = artifact("pr-body.md");

/**
 * For a run that creates: the ticket's thread so far, or "" when it has none. That is Oscar's
 * comments, which refine the ticket, and the latest explore findings if it was explored. Comments
 * before the findings are ones the explore run saw; those after them answer its open questions.
 * Oscar's comments outrank the description where they contradict it (they're newer, as explore
 * reads them too), and outrank the findings.
 */
export function renderThread(comments: readonly TicketComment[]): string {
  const latest = latestFindings(comments);
  const mine = comments.filter(isOscars);
  const sections: string[] = [];
  if (latest) {
    sections.push(
      `## Explore findings\n\nContext, not the spec: what an explore run found when it checked this ticket against the code. Start from its evidence and blast radius instead of rediscovering them. The ticket above is still the spec.\n\n${findingsBlock(latest.findings)}`,
    );
  }
  if (mine.length) {
    const since = latest ? ` Those dated after the findings (${latest.findings.createdAt.slice(0, 10)}) answer their open questions; where one contradicts the findings, follow the comment.` : "";
    sections.push(
      `## Oscar's comments\n\nOldest first. They refine the ticket: where one contradicts the description, follow the comment, which is newer, and record it as a decision.${since}\n\n${mine.map((c) => dated(c)).join("\n\n")}`,
    );
  }
  return sections.join("\n\n");
}

/**
 * `feedback` is null when the run creates (no branch on GitHub yet), or the rendered feedback
 * section when it builds on the ticket's existing branch. `thread` is `renderThread`'s output, for a create.
 */
export function promptVars(args: { feedback: string | null; thread: string }): Record<string, string> {
  const { feedback, thread } = args;
  return {
    prBodyPath: PR_BODY,
    thread,
    mode: feedback !== null ? "update" : "create",
    start:
      feedback !== null
        ? "checked out at the PR's current head in every repo that has it, and from an up-to-date `main` in the rest"
        : "checked out from an up-to-date `main` in every repo",
    feedback:
      feedback !== null
        ? `## Feedback for this round\n\nThe ticket's branch is already on GitHub with open PRs, so this run **updates** them. The ticket above is still the spec for the whole PR. The feedback below is what Oscar wants changed this round, on top of it.\n\n${feedback}`
        : "",
  };
}
