import { describe, expect, it } from "vitest";
import { factory, findingsComment as findings, oscar, renderPrompt } from "../../test/fixtures.ts";
import { promptVars, renderThread } from "./prompt.ts";

describe("explore's prompt", () => {
  it("renders read-only on origin/main, with the findings path, the shape and its thread", () => {
    const prompt = renderPrompt("explore", promptVars("## Oscar's comments\n\n2026-11-18:\n\n> Only for invoices."));
    expect(prompt).not.toMatch(/\{\{/);
    expect(prompt).toContain("Every repo is at `origin/main`, detached.");
    expect(prompt).toContain("Findings path: `/home/daytona/artifacts/findings.md`");
    expect(prompt).toContain("## Verdict: easy-call | human-needed");
    expect(prompt).toContain("> Only for invoices.");
    expect(prompt).not.toContain("oscar/rec-123");
  });
});

describe("renderThread", () => {
  it("is empty with no comments", () => {
    expect(renderThread([])).toBe("");
  });

  it("gives the earlier findings and all of Oscar's comments, without the factory's other comments", () => {
    const out = renderThread([
      oscar("Only for invoices.", "2026-11-18T09:00:00Z"),
      findings("## Verdict: human-needed", "2026-11-18T10:00:00Z"),
      factory("Picked up.", "2026-11-18T10:30:00Z"),
      oscar("Use the invoice date.", "2026-11-18T11:00:00Z"),
    ]);
    expect(out).toContain("## Earlier findings");
    expect(out).toContain("## Verdict: human-needed");
    expect(out).toContain("> Only for invoices.");
    expect(out).toContain("> Use the invoice date.");
    expect(out).not.toContain("Picked up.");
  });
});

