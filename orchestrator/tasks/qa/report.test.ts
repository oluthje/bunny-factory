import { describe, expect, it } from "vitest";
import { defect, flow, result } from "./fixtures.ts";
import { noLongerReproduces, parseCoverage, renderCoverage, renderDefect, stillReproduces, testedOn, uiGap, unpictured } from "./report.ts";

const uploads = {
  "checkout.png": { url: "https://up/checkout.png", name: "checkout.png" },
  "double-refund.webm": { url: "https://up/double-refund.webm", name: "double-refund.webm" },
  "refund_twice_spec.rb": { url: "https://up/spec.rb", name: "refund_twice_spec.rb" },
};

describe("renderDefect", () => {
  it("posts a defect in the shape the design fixes", () => {
    expect(renderDefect(4, defect({ agentNotes: "1 example, 1 failure" }), uploads)).toBe(
      [
        "**QA-4 · High · Invoices › Refunds**",
        "Refunding a paid invoice twice creates two credit notes",
        "",
        "**Steps**",
        "1. Log in as the seeded admin, open invoice INV-0012 (paid)",
        "2. Click Refund, confirm; click Refund again before the modal closes",
        "",
        "**Expected:** one credit note, second click ignored",
        "**Actual:** two credit notes for the full amount",
        "",
        "**Evidence:** [▶ double-refund.webm](https://up/double-refund.webm) · [refund_twice_spec.rb](https://up/spec.rb) (fails: expected 1, got 2)",
        "**Where:** `api/app/services/refund_invoice.rb:41`",
        "**Reproduced:** 3/3",
        "",
        "+++ Agent notes",
        "1 example, 1 failure",
        "+++",
      ].join("\n"),
    );
  });

  it("says when an evidence file never reached the orchestrator", () => {
    expect(renderDefect(1, defect({ evidence: [{ file: "gone.png", note: "" }] }), {})).toContain("**Evidence:** `gone.png` (missing)");
  });
});

describe("recheck replies", () => {
  const tested = testedOn("release/2026-11-25", { api: "abcdef1234", app: "1234567abc" });

  it("names the branch and each repo's commit", () => {
    expect(tested).toBe("`release/2026-11-25` (api `abcdef1`, app `1234567`)");
  });

  it("says a known defect still reproduces, with the fresh evidence", () => {
    expect(stillReproduces(defect(), tested, uploads)).toMatch(/^Still reproduces on `release\/2026-11-25` \(api `abcdef1`, app `1234567`\)\.\n\n\*\*Severity:\*\* High\n\*\*Actual:\*\* two credit notes/);
  });

  it("says whether a known defect that didn't reproduce looks fixed or just didn't reproduce", () => {
    const fixed = flow({ knownAs: "REC-77", knownOutcome: "fixed", knownNote: "api#1230 guards the second click." });
    expect(noLongerReproduces(fixed, tested, uploads)).toMatch(/^No longer reproduces on .*: fixed\. api#1230 guards the second click\.\n\n\*\*Evidence:\*\* \[checkout\.png\]/);
    expect(noLongerReproduces({ ...fixed, knownOutcome: "not-reproduced", knownNote: "" }, tested, uploads)).toMatch(/: couldn't reproduce\.\n/);
  });
});

describe("renderCoverage", () => {
  it("gives each flow a row, linked to its evidence or its defect, with the commits under the table", () => {
    const r = result({
      flows: [
        flow(),
        flow({ name: "Coupon | plan change", result: "defect", defect: 1, evidence: [] }),
        flow({ name: "Refund a paid invoice", result: "defect", defect: 2, evidence: [] }),
        flow({ name: "Pay via gateway", interface: "API", result: "blocked", blockedBy: "third-party APIs unreachable", evidence: [] }),
        flow({ name: "Export", interface: "API", result: "not-reached", evidence: [] }),
      ],
      defects: [defect(), defect({ knownAs: "REC-201 #4" })],
      suspects: [
        { suspect: "Proration rounds down", tried: "Three plan changes; totals matched.", evidence: [] },
        { suspect: "Stale totals after a price adjustment", tried: "Seen once in five tries.", evidence: [{ file: "double-refund.webm", note: "" }] },
      ],
    });
    const text = renderCoverage({
      result: r,
      defectLinks: [{ label: "QA-1", url: "https://linear/qa-1" }, { label: "REC-201 #4", url: "https://linear/rec-201-4" }],
      uploads,
      branch: "main",
      shas: { api: "abcdef1234" },
      scope: "UI and API",
    });
    expect(text).toContain("**QA coverage** of `main`: 5 flows · 1 passed · 2 hit a defect · 1 blocked · 1 not reached");
    expect(text).not.toContain("UI not covered");
    expect(text).toContain("| Guest checkout, card | ✅ Passed · [checkout.png](https://up/checkout.png) |");
    expect(text).toContain("| Coupon \\| plan change | ❌ [QA-1](https://linear/qa-1) |");
    expect(text).toContain("| Refund a paid invoice | ❌ Known: [REC-201 #4](https://linear/rec-201-4), still reproduces (High) |");
    expect(text).toContain("| Pay via gateway | ⛔ Blocked: third-party APIs unreachable |");
    expect(text).toContain("| Export | ⏭ Not reached (time) |");
    expect(text).toContain("**Commits tested:** api `abcdef1`");
    expect(text).toContain("+++ Passing evidence\n\n**Guest checkout, card**\n\n![checkout.png](https://up/checkout.png)\n\n+++");
    expect(text).toContain("+++ Suspects, not reproduced\n\n- **Proration rounds down**: Three plan changes; totals matched.\n- **Stale totals after a price adjustment**: Seen once in five tries. · [▶ double-refund.webm](https://up/double-refund.webm)\n\n+++");
  });
});

describe("uiGap", () => {
  const ui = (result: "passed" | "defect" | "blocked" | "not-reached") => flow({ result, defect: result === "defect" ? 1 : null });
  const api = flow({ name: "Quote API", interface: "API" });

  it("is null when every UI flow was walked, or the QA scope is API only", () => {
    expect(uiGap([ui("passed"), ui("defect"), api], "UI and API")).toBeNull();
    expect(uiGap([api], "API")).toBeNull();
    expect(uiGap([api], null)).toBeNull();
  });

  it("counts the UI flows a run didn't walk", () => {
    expect(uiGap([ui("not-reached"), ui("blocked"), api], "UI and API")).toBe("none of the 2 UI flows was walked.");
    expect(uiGap([ui("passed"), ui("not-reached"), ui("not-reached")], "UI")).toBe("2 of the 3 UI flows weren't walked.");
  });

  it("says so when a QA scope covering the UI came back with API flows only", () => {
    expect(uiGap([api], "UI and API")).toBe("the QA scope covers the UI, but no flow was walked in it.");
  });

  it("goes under the coverage head line, and reads back", () => {
    const text = renderCoverage({ result: result({ flows: [ui("not-reached"), api] }), defectLinks: [], uploads: {}, branch: "production", shas: {}, scope: "UI and API" });
    expect(text).toMatch(/^\*\*QA coverage\*\* of `production`: 2 flows · 1 passed · 0 hit a defect · 0 blocked · 1 not reached\n\n⚠️ \*\*UI not covered:\*\* its one UI flow wasn't walked\.\n\n\| Flow/);
    expect(parseCoverage(text)).toMatchObject({ flows: 2, notReached: 1, uiGap: "its one UI flow wasn't walked." });
    expect(parseCoverage(renderCoverage({ result: result(), defectLinks: [], uploads: {}, branch: "main", shas: {}, scope: "UI" }))?.uiGap).toBeNull();
  });
});

describe("unpictured", () => {
  it("names the UI flows walked with no screenshot or video, their defect's counted too", () => {
    const r = result({
      flows: [
        flow(),
        flow({ name: "Quantity input", evidence: [{ file: "quantity.txt", note: "" }] }),
        flow({ name: "Coupon apply", result: "defect", defect: 1, evidence: [] }),
        flow({ name: "Free months", result: "defect", defect: 2, evidence: [] }),
        flow({ name: "Quote API", interface: "API", evidence: [{ file: "quote.txt", note: "" }] }),
        flow({ name: "Proration", result: "not-reached", evidence: [] }),
      ],
      defects: [defect(), defect({ evidence: [{ file: "free-months-500.txt", note: "" }] })],
    });
    expect(unpictured(r)).toEqual(["Quantity input", "Free months"]);
    expect(renderCoverage({ result: r, defectLinks: [{ label: "QA-1", url: "u1" }, { label: "QA-2", url: "u2" }], uploads: {}, branch: "main", shas: {}, scope: "UI and API" })).toContain(
      "\n\n⚠️ **No picture:** Quantity input, Free months: walked in the UI, captured in none.\n\n",
    );
  });
});
