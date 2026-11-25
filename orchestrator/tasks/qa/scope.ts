// A QA scope's description: qa-plan writes it for every QA scope it proposes and files, and qa reads
// its `**Branch:**` line for the branch to test, so this module is qa's contract with qa-plan.
// Pure: no I/O, so it is unit-tested in scope.test.ts.

/** The `**Branch:** <name>` line, on a line of its own. */
const BRANCH_LINE = /^\s*\*\*Branch:\*\*\s*`?([^\s`]+)`?\s*$/m;

/** The branch a QA ticket names, or null when its description has no `**Branch:**` line. */
export function branchOf(description: string): string | null {
  return BRANCH_LINE.exec(description)?.[1] ?? null;
}

/** What a QA scope's description says. `owner` names the QA scope that owns a flow left out here. */
export type ScopeDescription = {
  branch: string;
  area: string;
  interface: "UI" | "API" | "UI and API";
  flows: readonly string[];
  releaseChanges: readonly string[];
  ownedElsewhere: readonly { what: string; owner: string }[];
};

/** A QA scope's title, as filed: `QA: Portal checkout`. */
export const scopeTitle = (area: string) => `QA: ${area}`;

/** The description, in the shape docs/qa-design.md fixes. */
export function renderScope(s: ScopeDescription): string {
  const lines = [`**Branch:** ${s.branch}`, `**Area:** ${s.area}`, `**Interface:** ${s.interface}`, "", "**Flows**", ...s.flows.map((f, i) => `${i + 1}. ${f}`)];
  lines.push("", "**Release changes in this area**", ...(s.releaseChanges.length ? s.releaseChanges.map((c) => `- ${c}`) : ["None."]));
  if (s.ownedElsewhere.length) lines.push("", "**Owned by another QA scope**", ...s.ownedElsewhere.map((o) => `- ${o.what} → ${o.owner}`));
  return lines.join("\n");
}
