// qa's placeholders in prompt.md: where to write the findings, and what prepare gathered: the release
// changes, the known defects and the runner gaps. Pure: no I/O, so it is unit-tested in prompt.test.ts.
import { artifact } from "../../src/runner-paths.ts";

/** Where the agent writes its findings: the run's own record, and what the structured pass reads. */
export const FINDINGS = artifact("qa-findings.md");

export function promptVars(args: { releaseChanges: string; knownDefects: string; runnerGaps: string }): Record<string, string> {
  return { findingsPath: FINDINGS, ...args };
}
