// explore's placeholders in prompt.md: where to write the findings, and the ticket's thread so far.
// Pure: no I/O, so it is unit-tested in prompt.test.ts.
import { dated, type TicketComment } from "../../src/comments.ts";
import { artifact } from "../../src/runner-paths.ts";
import { findingsBlock, isOscars, latestFindings } from "./findings.ts";

/** Where the agent writes its findings. */
export const FINDINGS = artifact("findings.md");

/** Oscar's comments on the ticket, and the latest findings if it was explored before. */
export function renderThread(comments: readonly TicketComment[]): string {
  const latest = latestFindings(comments);
  const mine = comments.filter(isOscars);
  const sections = [
    latest
      ? `## Earlier findings\n\nThe last explore run on this ticket. Build on it: check what Oscar's comments since then settle or change, and re-check its claims against the code as it is now.\n\n${findingsBlock(latest.findings)}`
      : null,
    mine.length ? `## Oscar's comments\n\nOldest first. They refine the ticket: where one contradicts the description, the comment is newer.\n\n${mine.map((c) => dated(c)).join("\n\n")}` : null,
  ].filter((s): s is string => s !== null);
  return sections.join("\n\n");
}

/** `thread` is `renderThread`'s output. */
export function promptVars(thread: string): Record<string, string> {
  return { findingsPath: FINDINGS, thread };
}
