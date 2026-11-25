import { describe, expect, it } from "vitest";
import { branchOf, renderScope, type ScopeDescription, scopeTitle } from "./scope.ts";

describe("branchOf", () => {
  it("reads the branch from the **Branch:** line", () => {
    expect(branchOf("**Branch:** release/2026-11-25\n**Area:** Portal checkout")).toBe("release/2026-11-25");
  });

  it("takes the branch in backticks too", () => {
    expect(branchOf("Focus: billing.\n\n**Branch:** `production`")).toBe("production");
  });

  it("is null without the line, so the run takes main", () => {
    expect(branchOf("Billing, portal checkout and the subscriptions API.")).toBeNull();
  });

  it("ignores the word inside a sentence", () => {
    expect(branchOf("The **Branch:** line is optional.")).toBeNull();
  });
});

describe("renderScope", () => {
  const scope: ScopeDescription = {
    branch: "release/2026-11-25",
    area: "Portal checkout",
    interface: "UI and API",
    flows: ["Guest checkout with card, single plan", "Checkout with coupon, then plan change"],
    releaseChanges: ['api#1234 "Prorate on plan change" (REC-88)'],
    ownedElsewhere: [{ what: "Invoice PDFs, refunds", owner: "QA: Billing (REC-201)" }],
  };

  it("writes the description docs/qa-design.md shows, which qa reads its branch from", () => {
    const text = renderScope(scope);
    expect(text).toBe(
      [
        "**Branch:** release/2026-11-25",
        "**Area:** Portal checkout",
        "**Interface:** UI and API",
        "",
        "**Flows**",
        "1. Guest checkout with card, single plan",
        "2. Checkout with coupon, then plan change",
        "",
        "**Release changes in this area**",
        '- api#1234 "Prorate on plan change" (REC-88)',
        "",
        "**Owned by another QA scope**",
        "- Invoice PDFs, refunds → QA: Billing (REC-201)",
      ].join("\n"),
    );
    expect(branchOf(text)).toBe("release/2026-11-25");
  });

  it("leaves out what no other QA scope owns", () => {
    expect(renderScope({ ...scope, ownedElsewhere: [], releaseChanges: [] })).toMatch(/\*\*Release changes in this area\*\*\nNone\.$/);
  });

  it("titles a filed QA scope by its area", () => {
    expect(scopeTitle("Billing")).toBe("QA: Billing");
  });
});
