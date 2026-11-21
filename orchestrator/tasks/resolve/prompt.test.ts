// resolve's placeholders: each open PR with why it needs the base merged in.
import { describe, expect, it } from "vitest";
import { renderPrompt } from "../../test/fixtures.ts";
import { promptVars, RESOLUTION } from "./prompt.ts";

describe("resolve promptVars", () => {
  it("lists each PR with why it needs the base merged in", () => {
    const vars = promptVars([
      { repo: "app", url: "https://github.com/bunnyapp/app/pull/1", why: "conflicts with its base." },
      { repo: "api", url: "https://github.com/bunnyapp/api/pull/2", why: null },
    ]);
    expect(vars.resolutionPath).toBe(RESOLUTION);
    expect(vars.prs).toBe(
      "- app: https://github.com/bunnyapp/app/pull/1: conflicts with its base.\n- api: https://github.com/bunnyapp/api/pull/2: GitHub shows no conflict now; merge the base in anyway, so it's up to date.",
    );
  });

  it("fills every placeholder in prompt.md, merging the base and never rebasing", () => {
    const prompt = renderPrompt("resolve", promptVars([{ repo: "app", url: "u", why: null }]));
    expect(prompt).toContain("git merge --no-edit origin/main");
    expect(prompt).toContain("Never rebase");
  });
});
