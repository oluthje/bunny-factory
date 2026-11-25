// fix-ci's placeholders in prompt.md: each failed check with its log up to its last error (cut by
// logs.ts before it gets here), and where to write the fix's account. Pure: no I/O, so it is
// unit-tested in prompt.test.ts.
import type { FailedCheck } from "../../src/checks.ts";
import { artifact } from "../../src/runner-paths.ts";

/** Where the agent writes what failed, what it changed, and how it checked it; or why it didn't. */
export const FIX = artifact("ci-fix.md");

/** One repo's open PR and the checks that failed on its head, each log already an excerpt. */
export type RedPr = { repo: string; url: string; checks: readonly FailedCheck[] };

export function promptVars(prs: readonly RedPr[], round: number, rounds: number): Record<string, string> {
  return {
    fixPath: FIX,
    round: `${round} of ${rounds}`,
    checks: prs.filter((p) => p.checks.length).map(renderPr).join("\n\n"),
  };
}

function renderPr(pr: RedPr): string {
  return [`### ${pr.repo}: ${pr.url}`, ...pr.checks.map(renderCheck)].join("\n\n");
}

function renderCheck(check: FailedCheck): string {
  const log = check.log?.trim() ?? "";
  return [
    `#### ${check.name}`,
    check.url,
    check.summary.trim() || null,
    log ? `The log, up to its last error:\n\n\`\`\`text\n${log}\n\`\`\`` : "No log: reproduce the check from its name and the repo's CI config.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
