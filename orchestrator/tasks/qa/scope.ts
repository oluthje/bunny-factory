// A QA scope's description, as the qa and qa-plan tasks read it: the `**Branch:**` line that names
// the branch to test. qa-plan writes the line into every QA scope it files, so this module is qa's
// contract with it. Pure: no I/O, so it is unit-tested in scope.test.ts.

/** The `**Branch:** <name>` line, on a line of its own. */
const BRANCH_LINE = /^\s*\*\*Branch:\*\*\s*`?([^\s`]+)`?\s*$/m;

/** The branch a QA ticket names, or null when its description has no `**Branch:**` line. */
export function branchOf(description: string): string | null {
  return BRANCH_LINE.exec(description)?.[1] ?? null;
}
