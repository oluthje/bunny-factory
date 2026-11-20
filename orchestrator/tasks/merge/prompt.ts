// merge's placeholders in prompt.md: where to write the verdict, each open PR with its CI and what
// review and Oscar said on it, and the ticket's thread. Pure: no I/O, so it is unit-tested in prompt.test.ts.
import type { CiState } from "../../src/checks.ts";
import { dated, type PrComment, type ReviewThread, type TicketComment } from "../../src/comments.ts";
import { GITHUB_MARKER } from "../../src/logic.ts";
import { artifact } from "../../src/runner-paths.ts";
import { findingsBlock, isOscars, latestFindings } from "../explore/findings.ts";

/** Where the agent writes its verdict. */
export const VERDICT = artifact("merge-verdict.md");

/** One open PR, as the merge run reads it. */
export type PrContext = {
  repo: string;
  url: string;
  ci: CiState;
  body: string;
  /** Reviews with a body: the factory's review run posts one. */
  reviews: PrComment[];
  comments: PrComment[];
  threads: ReviewThread[];
};

export function ciLine(ci: CiState): string {
  if (ci.state !== "green") return `CI: ${ci.state}`;
  return ci.checks === 0 ? "CI: green, but no checks ran on this PR" : `CI: green (${ci.checks} checks)`;
}

function renderPr(pr: PrContext): string {
  const open = pr.threads.filter((t) => !t.isResolved);
  return [
    `### ${pr.repo}: ${pr.url}`,
    ciLine(pr.ci),
    pr.body.trim() ? `<pr-body>\n${pr.body.replaceAll(GITHUB_MARKER, "").trim()}\n</pr-body>` : "The PR has no body.",
    pr.reviews.length ? `#### Reviews\n\n${pr.reviews.map((r) => dated(r, `${r.author}, `)).join("\n\n")}` : null,
    open.length
      ? `#### Unresolved review threads\n\n${open
          .map((t) => `\`${t.path}${t.line ? `:${t.line}` : ""}\`\n\n${t.comments.map((c) => dated(c, `${c.author}, `)).join("\n\n")}`)
          .join("\n\n")}`
      : null,
    pr.comments.length ? `#### Comments\n\n${pr.comments.map((c) => dated(c, `${c.author}, `)).join("\n\n")}` : null,
  ]
    .filter((s): s is string => s !== null)
    .join("\n\n");
}

/** Oscar's comments on the ticket, and the latest explore findings if it was explored. */
export function renderThread(comments: readonly TicketComment[]): string {
  const latest = latestFindings(comments);
  const mine = comments.filter(isOscars);
  return [
    latest ? `## Explore findings\n\nWhat the explore run found before the PRs were written.\n\n${findingsBlock(latest.findings)}` : null,
    mine.length ? `## Oscar's comments\n\nOldest first. They refine the ticket: where one contradicts the description, the comment is newer.\n\n${mine.map((c) => dated(c)).join("\n\n")}` : null,
  ]
    .filter((s): s is string => s !== null)
    .join("\n\n");
}

export function promptVars({ prs, ticketComments }: { prs: readonly PrContext[]; ticketComments: readonly TicketComment[] }): Record<string, string> {
  return {
    verdictPath: VERDICT,
    prs: prs.map(renderPr).join("\n\n"),
    thread: renderThread(ticketComments),
  };
}
