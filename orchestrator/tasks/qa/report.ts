// What a qa run posts, rendered from its structured result (result.ts): one comment per new defect,
// a recheck reply on each known defect it walked, and the coverage summary, a row per flow with
// every result linked to its evidence. Pure: no I/O, so it is unit-tested in report.test.ts.
import { isImage, isVideo, type Uploaded } from "../../src/evidence.ts";
import { NO_LONGER_REPRODUCES, type Severity } from "./defects.ts";
import type { Defect, Flow, QaResult } from "./result.ts";
import type { ScopeInterface } from "./scope.ts";

/** The tag on the coverage summary's marker line: the QA verdict sweep reads it. */
export const COVERAGE_TAG = "qa coverage";

type Evidence = Defect["evidence"];
/** Each evidence file's upload, by its name in the evidence directory. */
export type Uploads = Record<string, Uploaded>;

/** Each repo's commit, short: `api \`abc1234\`, app \`def5678\``. */
const commits = (shas: Record<string, string>) => Object.entries(shas).map(([repo, sha]) => `${repo} \`${sha.slice(0, 7)}\``).join(", ");

/** What was tested, for a recheck reply: the branch and each repo's commit. */
export function testedOn(branch: string, shas: Record<string, string>): string {
  return Object.keys(shas).length ? `\`${branch}\` (${commits(shas)})` : `\`${branch}\``;
}

const cell = (s: string) => s.replaceAll("|", "\\|").replaceAll("\n", " ");

/** The evidence as links, each with its note: a file the run never wrote says so. */
function links(evidence: Evidence, uploads: Uploads): string {
  return evidence
    .map(({ file, note }) => {
      const up = uploads[file];
      const link = up ? `[${isVideo(up.name) ? "▶ " : ""}${file}](${up.url})` : `\`${file}\` (missing)`;
      return note ? `${link} (${note})` : link;
    })
    .join(" · ");
}

/** The evidence's images, shown inline. */
function images(evidence: Evidence, uploads: Uploads): string[] {
  return evidence.flatMap(({ file }) => {
    const up = uploads[file];
    return up && isImage(up.name) ? [`![${file}](${up.url})`] : [];
  });
}

/** A new defect's comment, without the factory's marker line. */
export function renderDefect(number: number, d: Defect, uploads: Uploads): string {
  const lines = [
    `**QA-${number} · ${d.severity} · ${d.area}**`,
    d.title,
    "",
    "**Steps**",
    ...d.steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    `**Expected:** ${d.expected}`,
    `**Actual:** ${d.actual}`,
    "",
    `**Evidence:** ${links(d.evidence, uploads) || "None"}`,
    `**Where:** ${d.where.length ? d.where.map((w) => `\`${w}\``).join(", ") : "Not found"}`,
    `**Reproduced:** ${d.reproduced}`,
  ];
  const shown = images(d.evidence, uploads);
  if (shown.length) lines.push("", ...shown);
  if (d.agentNotes.trim()) lines.push("", "+++ Agent notes", d.agentNotes.trim(), "+++");
  return lines.join("\n");
}

/** The reply on a known defect that reproduced again. */
export function stillReproduces(d: Defect, tested: string, uploads: Uploads): string {
  return [`Still reproduces on ${tested}.`, "", `**Severity:** ${d.severity}`, `**Actual:** ${d.actual}`, `**Evidence:** ${links(d.evidence, uploads) || "None"}`, ...images(d.evidence, uploads)].join("\n");
}

/** Why a known defect no longer reproduces, in words. */
const knownOutcomeWords = (f: Flow) => (f.knownOutcome === "fixed" ? "fixed" : "couldn't reproduce");

/** The reply on a known defect whose steps the run walked and that didn't reproduce. */
export function noLongerReproduces(f: Flow, tested: string, uploads: Uploads): string {
  return [`${NO_LONGER_REPRODUCES} on ${tested}: ${knownOutcomeWords(f)}. ${f.knownNote}`.trim(), "", `**Evidence:** ${links(f.evidence, uploads) || "None"}`, ...images(f.evidence, uploads)].join(
    "\n",
  );
}

/** Where each defect the run hit is on Linear: a new one's comment, or the known defect it matched. */
export type DefectLinks = { label: string; url: string }[];

function resultCell(f: Flow, defects: readonly Defect[], defectLinks: DefectLinks, uploads: Uploads): string {
  const ev = links(f.evidence, uploads);
  const withEvidence = (s: string) => (ev ? `${s} · ${ev}` : s);
  switch (f.result) {
    case "passed": {
      const known = f.knownAs ? ` · ${f.knownAs} no longer reproduces (${knownOutcomeWords(f)})` : "";
      return withEvidence(`✅ Passed${known}`);
    }
    case "defect": {
      const d = defects[f.defect! - 1]!;
      const to = defectLinks[f.defect! - 1]!;
      return d.knownAs ? `❌ Known: [${to.label}](${to.url}), still reproduces (${d.severity})` : `❌ [${to.label}](${to.url})`;
    }
    case "blocked":
      return withEvidence(`⛔ Blocked: ${f.blockedBy}`);
    case "not-reached":
      return "⏭ Not reached (time)";
  }
}

/** The label of the coverage summary's warning line when UI flows went unwalked: the QA verdict reads it. */
const UI_GAP = "⚠️ **UI not covered:** ";

/**
 * What a run left of the UI unwalked, in words, or null when it walked every UI flow. A QA scope that
 * covers the UI but came back with no UI flow at all says so too: the API is quicker, and a run that
 * spends its time there tests the wrong half.
 */
export function uiGap(flows: readonly Flow[], scope: ScopeInterface | null): string | null {
  if (scope === "API") return null;
  const ui = flows.filter((f) => f.interface === "UI");
  const walked = ui.filter((f) => f.result === "passed" || f.result === "defect").length;
  if (!ui.length) return scope ? "the QA scope covers the UI, but no flow was walked in it." : null;
  if (walked === ui.length) return null;
  if (walked === 0) return ui.length === 1 ? "its one UI flow wasn't walked." : `none of the ${ui.length} UI flows was walked.`;
  return `${ui.length - walked} of the ${ui.length} UI flows weren't walked.`;
}

/** The label of the coverage summary's line naming the UI flows walked without a screenshot or video. */
const NO_PICTURE = "⚠️ **No picture:** ";

/** The UI flows walked, passed or hit a defect, with no screenshot or video among their evidence or their defect's. */
export function unpictured(result: QaResult): string[] {
  const pictured = (ev: Evidence) => ev.some(({ file }) => isImage(file) || isVideo(file));
  return result.flows
    .filter((f) => f.interface === "UI" && (f.result === "passed" || f.result === "defect"))
    .filter((f) => !pictured(f.evidence) && !(f.defect !== null && pictured(result.defects[f.defect - 1]?.evidence ?? [])))
    .map((f) => f.name);
}

/** The coverage summary: a row per flow, the commits tested, then the passing evidence and the suspects, folded. */
export function renderCoverage(args: {
  result: QaResult;
  defectLinks: DefectLinks;
  uploads: Uploads;
  branch: string;
  shas: Record<string, string>;
  /** The QA scope's `**Interface:**` line, or null when it has none. */
  scope: ScopeInterface | null;
}): string {
  const { result, defectLinks, uploads, branch, shas, scope } = args;
  const count = (r: Flow["result"]) => result.flows.filter((f) => f.result === r).length;
  const head = `**QA coverage** of \`${branch}\`: ${result.flows.length} flows · ${count("passed")} passed · ${count("defect")} hit a defect · ${count("blocked")} blocked · ${count("not-reached")} not reached`;
  const table = [
    "| Flow | Result |",
    "|---|---|",
    ...result.flows.map((f) => `| ${cell(f.name)} | ${cell(resultCell(f, result.defects, defectLinks, uploads))} |`),
  ];
  const gap = uiGap(result.flows, scope);
  const bare = unpictured(result);
  const warnings = [...(gap ? [`${UI_GAP}${gap}`] : []), ...(bare.length ? [`${NO_PICTURE}${bare.join(", ")}: walked in the UI, captured in none.`] : [])];
  const sections = [[head, ...warnings].join("\n\n"), table.join("\n"), `**Commits tested:** ${commits(shas) || "unknown"}`];
  const passing = result.flows.filter((f) => f.result === "passed" && f.evidence.length);
  if (passing.length) {
    const shown = passing.map((f) => [`**${f.name}**`, ...(images(f.evidence, uploads).length ? images(f.evidence, uploads) : [links(f.evidence, uploads)])].join("\n\n"));
    sections.push(`+++ Passing evidence\n\n${shown.join("\n\n")}\n\n+++`);
  }
  if (result.suspects.length) {
    const suspect = (s: QaResult["suspects"][number]) => {
      const ev = links(s.evidence, uploads);
      return `- **${s.suspect}**: ${s.tried}${ev ? ` · ${ev}` : ""}`;
    };
    sections.push(`+++ Suspects, not reproduced\n\n${result.suspects.map(suspect).join("\n")}\n\n+++`);
  }
  return sections.join("\n\n");
}

/** A coverage summary read back, for the QA verdict. */
export type Coverage = {
  branch: string;
  flows: number;
  passed: number;
  defects: number;
  blocked: number;
  notReached: number;
  /** The known defects that reproduced again, each with the severity it had in this run. */
  known: { ref: string; url: string; severity: Severity }[];
  blockedFlows: { flow: string; gap: string }[];
  /** What the run left of the UI unwalked, in words, or null. */
  uiGap: string | null;
  /** The commits line, as written: `api \`abc1234\`, app \`def5678\``. */
  commits: string;
};

const HEAD_LINE = /^\*\*QA coverage\*\* of `([^`]+)`: (\d+) flows · (\d+) passed · (\d+) hit a defect · (\d+) blocked · (\d+) not reached$/m;
const ROW = /^\| ((?:[^|\\]|\\.)*) \| (.*) \|$/gm;
const KNOWN_CELL = /^❌ Known: \[([^\]]+)\]\(([^)]+)\), still reproduces \((Blocker|High|Medium|Low)\)/;

/** The coverage summary in a comment's text, as `renderCoverage` wrote it, or null. */
export function parseCoverage(text: string): Coverage | null {
  const head = HEAD_LINE.exec(text);
  if (!head) return null;
  const [, branch, flows, passed, defects, blocked, notReached] = head;
  const known: Coverage["known"] = [];
  const blockedFlows: Coverage["blockedFlows"] = [];
  for (const [, name, result] of text.matchAll(ROW)) {
    const flow = name!.replaceAll("\\|", "|");
    const k = KNOWN_CELL.exec(result!);
    if (k) known.push({ ref: k[1]!, url: k[2]!, severity: k[3] as Severity });
    if (result!.startsWith("⛔ Blocked: ")) blockedFlows.push({ flow, gap: result!.slice("⛔ Blocked: ".length).split(" · ")[0]! });
  }
  const commits = /^\*\*Commits tested:\*\* (.*)$/m.exec(text)?.[1] ?? "unknown";
  const gap = text.split("\n").find((l) => l.startsWith(UI_GAP))?.slice(UI_GAP.length) ?? null;
  return { branch: branch!, flows: +flows!, passed: +passed!, defects: +defects!, blocked: +blocked!, notReached: +notReached!, known, blockedFlows, uiGap: gap, commits };
}
