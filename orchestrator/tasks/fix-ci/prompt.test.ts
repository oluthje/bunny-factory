// fix-ci's placeholders: each failed check with its log, and the round.
import { describe, expect, it } from "vitest";
import { renderPrompt } from "../../test/fixtures.ts";
import { FIX, promptVars } from "./prompt.ts";

const prs = [
  {
    repo: "app",
    url: "https://github.com/bunnyapp/app/pull/1",
    checks: [{ name: "build", url: "https://github.com/bunnyapp/app/actions/runs/1/job/2", summary: "", log: "FAIL outputCss\n##[error]exit 1" }],
  },
  { repo: "api", url: "https://github.com/bunnyapp/api/pull/2", checks: [] },
];

describe("fix-ci promptVars", () => {
  it("lists each red PR's failed checks with their logs, and skips a green PR", () => {
    const vars = promptVars(prs, 2, 3);
    expect(vars.fixPath).toBe(FIX);
    expect(vars.round).toBe("2 of 3");
    expect(vars.checks).toBe(
      "### app: https://github.com/bunnyapp/app/pull/1\n\n#### build\n\nhttps://github.com/bunnyapp/app/actions/runs/1/job/2\n\nThe log, up to its last error:\n\n```text\nFAIL outputCss\n##[error]exit 1\n```",
    );
  });

  it("says so when a check has no log", () => {
    const vars = promptVars([{ repo: "app", url: "u", checks: [{ name: "ci/circleci", url: null, summary: "Failed", log: null }] }], 1, 3);
    expect(vars.checks).toContain("Failed\n\nNo log: reproduce the check");
  });

  it("fills every placeholder in prompt.md, checking the base before fixing", () => {
    const prompt = renderPrompt("fix-ci", promptVars(prs, 1, 3));
    expect(prompt).toContain("run the same command there");
    expect(prompt).toContain("Never skip, delete or loosen a test");
  });
});
