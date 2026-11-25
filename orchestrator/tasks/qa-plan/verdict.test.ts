import { describe, expect, it } from "vitest";
import { linearComment } from "../../src/logic.ts";
import { DEFECT_TAG, RECHECK_TAG } from "../qa/defects.ts";
import { defect, threaded } from "../qa/fixtures.ts";
import { COVERAGE_TAG, renderCoverage, renderDefect } from "../qa/report.ts";
import { result, flow } from "../qa/fixtures.ts";
import { countOnce, type Counted, perScope, fingerprintOf, knownCounted, lastRunCoverage, postedDefects, renderVerdict, verdictOf } from "./verdict.ts";

const counted = (over: Partial<Counted> = {}): Counted => ({ ref: "REC-201 #1", url: "u1", title: "T", severity: "Medium", scope: "REC-201", duplicateOf: null, ...over });
const posted = (n: number, severity: "Blocker" | "High" | "Medium" | "Low" = "High") => threaded(linearComment(renderDefect(n, defect({ severity }), {}), "run-1", DEFECT_TAG));
const reply = (to: { id: string }, body: string, isMe = true) => threaded(body, { parentId: to.id, isMe });

describe("the rule", () => {
  it("is no-go on any Blocker, go with caveats on any High, otherwise go", () => {
    expect(verdictOf([counted({ severity: "Blocker" }), counted({ severity: "Low" })])).toBe("no-go");
    expect(verdictOf([counted({ severity: "High" })])).toBe("go with caveats");
    expect(verdictOf([counted({ severity: "Medium" })])).toBe("go");
    expect(verdictOf([])).toBe("go");
  });
});

describe("postedDefects", () => {
  it("takes Oscar's latest regrade in the thread over the run's severity", () => {
    const top = posted(4, "Blocker");
    const comments = [top, reply(top, "Regrade: Medium, only on legacy plans"), reply(top, "Regrade: High because refunds"), reply(top, "Regrade: Low", false)];
    expect(postedDefects({ identifier: "REC-201" }, "REC-201", comments)).toEqual([expect.objectContaining({ ref: "REC-201 #4", severity: "High" })]);
  });

  it("reads Oscar's duplicate mark, and drops a defect a later run found gone", () => {
    const a = posted(1);
    const b = posted(2);
    const comments = [a, b, reply(a, "Duplicate of REC-202 #3"), reply(b, linearComment("No longer reproduces on `main`: fixed.", "run-2", RECHECK_TAG))];
    expect(postedDefects({ identifier: "REC-201" }, "REC-201", comments)).toEqual([expect.objectContaining({ ref: "REC-201 #1", duplicateOf: "REC-202 #3" })]);
  });
});

describe("countOnce", () => {
  it("counts a duplicate pair once, at the graver severity", () => {
    const once = countOnce([counted({ ref: "REC-202 #3", severity: "Medium", scope: "REC-202" }), counted({ ref: "REC-201 #1", severity: "High", duplicateOf: "REC-202 #3" })]);
    expect(once).toEqual([expect.objectContaining({ ref: "REC-202 #3", severity: "High" })]);
  });

  it("counts the same known defect hit by two QA scopes once", () => {
    expect(countOnce([counted({ ref: "REC-77", severity: "Low" }), counted({ ref: "REC-77", severity: "Blocker", scope: "REC-202" })])).toEqual([
      expect.objectContaining({ ref: "REC-77", severity: "Blocker" }),
    ]);
  });

  it("survives a duplicate loop", () => {
    expect(countOnce([counted({ ref: "A #1", duplicateOf: "B #1" }), counted({ ref: "B #1", duplicateOf: "A #1" })])).toHaveLength(1);
  });
});

describe("knownCounted", () => {
  it("takes Oscar's regrade from the known defect's own thread", () => {
    const top = posted(4, "Blocker");
    const k = { ref: "REC-150 #4", url: top.url, severity: "Blocker" as const };
    expect(knownCounted(k, "REC-201", { identifier: "REC-150", comments: [top, reply(top, "Regrade: Low")] }).severity).toBe("Low");
    expect(knownCounted({ ...k, ref: "REC-77" }, "REC-201", null).severity).toBe("Blocker");
  });
});

describe("renderVerdict", () => {
  const coverageComment = (over = {}) =>
    threaded(
      linearComment(
        renderCoverage({
          result: result({ flows: [flow(), flow({ name: "Pay via gateway", interface: "API", result: "blocked", blockedBy: "third-party APIs unreachable", evidence: [] })], ...over }),
          defectLinks: [],
          uploads: {},
          branch: "release/2026-11-25",
          shas: { api: "abcdef1234" },
          scope: "UI and API",
        }),
        "run-1",
        COVERAGE_TAG,
      ),
    );

  it("counts a QA scope's coverage only while its last run's report is that coverage", () => {
    const failed = threaded(linearComment("The run failed: catch-up timed out.", "run-2"));
    const defectOfRun2 = threaded(linearComment(renderDefect(3, defect(), {}), "run-2", DEFECT_TAG));
    expect(lastRunCoverage([coverageComment(), defectOfRun2])).not.toBeNull();
    expect(lastRunCoverage([coverageComment(), failed])).toBeNull();
    expect(lastRunCoverage([coverageComment(), threaded("Oscar: looks fine")])).not.toBeNull();
  });

  it("reads a QA scope's latest coverage back", () => {
    expect(lastRunCoverage([coverageComment()])).toMatchObject({ branch: "release/2026-11-25", flows: 2, passed: 1, blocked: 1, blockedFlows: [{ flow: "Pay via gateway", gap: "third-party APIs unreachable" }] });
    expect(lastRunCoverage([threaded("Oscar's note")])).toBeNull();
  });

  it("posts the verdict, a row per QA scope, the graves, the commits, and what needs a human", () => {
    const coverage = lastRunCoverage([coverageComment()]);
    const text = renderVerdict({
      scopes: [{ identifier: "REC-201", title: "QA: Billing", url: "https://linear/REC-201", finished: true, coverage }],
      defects: [counted({ severity: "High", title: "Refunding twice creates two credit notes" }), counted({ ref: "REC-201 #2", severity: "Low" })],
      needsHuman: ["Invoice emails: third-party APIs unreachable"],
    });
    expect(text).toMatch(/^\*\*QA verdict: go with caveats\*\* · `release\/2026-11-25`\n\n0 Blocker, 1 High, 0 Medium, 1 Low: each defect once, after Oscar's regrades\./);
    expect(text).toContain("| [REC-201](https://linear/REC-201) QA: Billing | 1/2 | 0 | 1 | 0 | 1 | 1 | 0 |");
    expect(text).toContain("**Blockers and Highs**\n\n- **High** [REC-201 #1](u1) Refunding twice creates two credit notes");
    expect(text).toContain("**Commits tested:** api `abcdef1`");
    expect(text).toContain("**Needs a human**\n\n- Invoice emails: third-party APIs unreachable\n- Pay via gateway (REC-201): blocked, third-party APIs unreachable");
  });

  it("puts a QA scope whose UI flows went unwalked under what needs a human", () => {
    const coverage = lastRunCoverage([coverageComment({ flows: [flow({ result: "not-reached", evidence: [] }), flow({ name: "Quote API", interface: "API" })] })]);
    expect(coverage?.uiGap).toBe("its one UI flow wasn't walked.");
    const text = renderVerdict({ scopes: [{ identifier: "REC-201", title: "QA: Billing", url: "https://linear/REC-201", finished: true, coverage }], defects: [], needsHuman: [] });
    expect(text).toContain("**Needs a human**\n\n- REC-201: UI not covered, its one UI flow wasn't walked.");
  });

  it("ends with a fingerprint that changes only when the verdict does", () => {
    const coverage = lastRunCoverage([coverageComment()]);
    const args = { scopes: [{ identifier: "REC-201", title: "QA: Billing", url: "u", finished: true, coverage }], defects: [counted()], needsHuman: [] };
    const a = fingerprintOf(renderVerdict(args));
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(fingerprintOf(renderVerdict(args))).toBe(a);
    expect(fingerprintOf(renderVerdict({ ...args, defects: [counted({ severity: "Blocker" })] }))).not.toBe(a);
  });
});

describe("perScope", () => {
  it("counts a defect its scope's later run met again once, at that run's severity", () => {
    const once = perScope([counted({ ref: "REC-201 #1", severity: "Blocker", title: "Two credit notes" })], [counted({ ref: "REC-201 #1", severity: "Low", title: "" })]);
    expect(once).toEqual([expect.objectContaining({ ref: "REC-201 #1", severity: "Low", title: "Two credit notes" })]);
  });
});
