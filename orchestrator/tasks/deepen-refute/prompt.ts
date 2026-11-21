// deepen-refute's placeholders in prompt.md: where to write the conclusion and the report, and the
// ticket's thread so far. Pure: no I/O, so it is unit-tested in prompt.test.ts.
import { dated, type TicketComment } from "../../src/comments.ts";
import { isFactoryComment } from "../../src/logic.ts";
import { artifact } from "../../src/runner-paths.ts";
import { conclusionText, latestConclusion } from "./conclusion.ts";

/** Where the agent writes its conclusion, and its HTML report of it. */
export const CONCLUSION = artifact("conclusion.md");
export const REPORT = artifact("refute-report.html");

/** The last conclusion if the candidate was refuted before, and Oscar's comments on the ticket. */
export function renderThread(comments: readonly TicketComment[]): string {
  const latest = latestConclusion(comments);
  const mine = comments.filter((c) => c.isMe && !isFactoryComment(c.body));
  const sections = [
    latest
      ? `## Earlier conclusion\n\nThe last deepen-refute run on this candidate. Oscar's comments after it push back on it: start from the points he makes.\n\n<conclusion date="${latest.createdAt.slice(0, 10)}">\n${conclusionText(latest.body)}\n</conclusion>`
      : null,
    mine.length
      ? `## Oscar's comments\n\nOldest first. Each point in them is a claim like any other: check it against the code, and let it change the verdict where it holds.\n\n${mine.map((c) => dated(c)).join("\n\n")}`
      : null,
  ].filter((s): s is string => s !== null);
  return sections.join("\n\n");
}

/** `thread` is `renderThread`'s output. */
export function promptVars(thread: string): Record<string, string> {
  return { conclusionPath: CONCLUSION, reportPath: REPORT, thread };
}
