import { describe, expect, it } from "vitest";
import { renderPrompt } from "../../test/fixtures.ts";
import { skillSection } from "../../src/prompt.ts";
import { FINDINGS, promptVars } from "./prompt.ts";

describe("qa's prompt", () => {
  const runnerGaps = skillSection("factory-stack", "Runner gaps");
  const prompt = renderPrompt("qa", promptVars({ releaseChanges: "RELEASE", knownDefects: "KNOWN", runnerGaps }));

  it("fills every placeholder: the release changes, known defects, runner gaps and findings path", () => {
    expect(prompt).toContain("RELEASE");
    expect(prompt).toContain("KNOWN");
    expect(prompt).toContain(`Findings path: \`${FINDINGS}\``);
  });

  it("carries factory-stack's runner gaps, so the list lives in one place", () => {
    expect(runnerGaps).toMatch(/^What production does that the runner can't/);
    expect(runnerGaps).toContain("Gateway rate limits");
    expect(prompt).toContain(runnerGaps);
  });
});
