// A QA scope's description: qa-plan writes it for every QA scope it proposes and files, and qa reads
// its `**Branch:**` line for the branch to test and its `**Interface:**` line for whether the UI is
// in it, so this module is qa's contract with qa-plan.
// Pure: no I/O, so it is unit-tested in scope.test.ts.

/** The `**Branch:** <name>` line, on a line of its own. */
const BRANCH_LINE = /^\s*\*\*Branch:\*\*\s*`?([^\s`]+)`?\s*$/m;

/** The branch a QA ticket names, or null when its description has no `**Branch:**` line. */
export function branchOf(description: string): string | null {
  return BRANCH_LINE.exec(description)?.[1] ?? null;
}

/** The `**Interface:** UI | API | UI and API` line. */
const INTERFACE_LINE = /^\s*\*\*Interface:\*\*\s*(UI and API|UI|API)\s*$/m;

/** Whether a QA scope covers the UI, the API or both, or null when its description doesn't say (a hand-filed one). */
export function interfaceOf(description: string): ScopeInterface | null {
  return (INTERFACE_LINE.exec(description)?.[1] as ScopeInterface | undefined) ?? null;
}

export type ScopeInterface = "UI" | "API" | "UI and API";

/** How long a qa run gets: qa-plan sizes each QA scope to fit it. */
export const QA_TIME_LIMIT_MINUTES = 90;

/** What a flow costs a qa run, by where it's walked: the browser is slower, and a defect there gets a video. */
export const FLOW_MINUTES = { UI: 8, API: 4 } as const;

/** The minutes a QA scope's flows may add up to: the rest of the run is setup, the code hunt and the findings. */
export const SCOPE_BUDGET_MINUTES = 64;

/** A flow's mark, the `(UI)` or `(API)` that ends it, or null when it has none (a hand-filed QA scope). */
export function markOf(flow: string): keyof typeof FLOW_MINUTES | null {
  return (/\((UI|API)\)\s*$/.exec(flow)?.[1] as keyof typeof FLOW_MINUTES | undefined) ?? null;
}

/** What a QA scope's marked flows cost a qa run, in minutes. */
export const scopeMinutes = (flows: readonly string[]) => flows.reduce((sum, f) => sum + (FLOW_MINUTES[markOf(f) ?? "UI"]), 0);

/** What a QA scope's description says. `owner` names the QA scope that owns a flow left out here. */
export type ScopeDescription = {
  branch: string;
  area: string;
  interface: ScopeInterface;
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
