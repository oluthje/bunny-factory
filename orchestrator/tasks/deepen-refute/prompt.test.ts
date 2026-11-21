import { describe, expect, it } from "vitest";
import { linearComment } from "../../src/logic.ts";
import { factory, oscar, renderPrompt } from "../../test/fixtures.ts";
import { CONCLUSION_TAG } from "./conclusion.ts";
import { promptVars, renderThread } from "./prompt.ts";

describe("deepen-refute's prompt", () => {
  it("renders read-only on origin/main, with both paths, the method, the shape and its thread", () => {
    const prompt = renderPrompt("deepen-refute", promptVars("## Oscar's comments\n\n2026-11-20:\n\n> It already has two adapters."));
    expect(prompt).not.toMatch(/\{\{/);
    expect(prompt).toContain("at `origin/main`, detached");
    expect(prompt).toContain("Conclusion path: `/home/daytona/artifacts/conclusion.md`");
    expect(prompt).toContain("Report path: `/home/daytona/artifacts/refute-report.html`");
    expect(prompt).toContain("`/home/daytona/run/method.md`");
    expect(prompt).toContain("## Verdict: do it | don't | not yet");
    expect(prompt).toContain("> It already has two adapters.");
  });
});

describe("renderThread", () => {
  it("is empty with no comments", () => {
    expect(renderThread([])).toBe("");
  });

  it("gives the earlier conclusion and Oscar's comments, without the factory's other comments", () => {
    const out = renderThread([
      { body: linearComment("Refuted: **don't**.\n\n+++ Full conclusion\n\n## Verdict: don't\n\nToo costly.\n\n+++", "run-1", CONCLUSION_TAG), createdAt: "2026-11-20T10:00:00Z", isMe: true },
      factory("Picked up.", "2026-11-20T10:30:00Z"),
      oscar("It already has two adapters.", "2026-11-20T11:00:00Z"),
    ]);
    expect(out).toContain('<conclusion date="2026-11-20">\n## Verdict: don\'t\n\nToo costly.\n</conclusion>');
    expect(out).toContain("> It already has two adapters.");
    expect(out).not.toContain("Picked up.");
    expect(out).not.toContain("Refuted:");
  });
});
