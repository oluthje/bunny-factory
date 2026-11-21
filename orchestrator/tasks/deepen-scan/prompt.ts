// deepen-scan's placeholders in prompt.md: where to write the candidates and the report, and the
// candidates earlier scans proposed. Pure: no I/O, so it is unit-tested in prompt.test.ts.
import { artifact } from "../../src/runner-paths.ts";
import { CANDIDATE_CAP } from "./candidates.ts";

/** Where the agent writes its candidates, and its HTML report of them. */
export const CANDIDATES = artifact("candidates.md");
export const REPORT = artifact("scan-report.html");

/** `earlier` is `renderEarlier`'s output. */
export function promptVars(earlier: string): Record<string, string> {
  return { candidatesPath: CANDIDATES, reportPath: REPORT, earlier, candidateCap: String(CANDIDATE_CAP) };
}
