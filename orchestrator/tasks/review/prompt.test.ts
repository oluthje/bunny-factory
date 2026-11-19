import { describe, expect, it } from "vitest";
import { renderPrompt } from "../../test/fixtures.ts";
import { promptVars } from "./prompt.ts";

const render = (prBody: string | null = null) => renderPrompt("review", promptVars(prBody));

describe("review's prompt", () => {
  it("renders with no placeholder left, on the ticket's branch", () => {
    expect(render()).not.toMatch(/\{\{/);
    expect(render()).toContain("`oscar/rec-123-show-the-refund-date-on-invoices`");
  });

  it("has review fix what it's sure of, commit, and leave pushing to the factory", () => {
    const prompt = render();
    expect(prompt).toMatch(/^4\. Fix the findings you're sure of/m);
    expect(prompt).toContain("## Fixed");
    expect(prompt).toContain("Commit prefix: `REC-123: `");
    expect(prompt).toContain("no push");
  });

  it("gives review the PR body as context, without the factory's marker, and the ticket as the spec", () => {
    const prompt = render("## Decisions\n\n- Kept the old endpoint: Oscar asked.\n\n<!-- oscar-factory -->");
    expect(prompt).toContain("## The PR body\n\nContext, not the spec");
    expect(prompt).toContain("- Kept the old endpoint: Oscar asked.");
    expect(prompt).not.toContain("<!-- oscar-factory -->");
    expect(prompt).toContain("the spec is the ticket above, read with the PR body's Decisions");
    expect(render()).not.toContain("## The PR body");
  });

  it("asks the review for code-review, the review path and the missing-rules section", () => {
    const prompt = render();
    expect(prompt).toContain("`code-review`");
    expect(prompt).toContain("`/home/daytona/artifacts/review.md`");
    expect(prompt).toContain("## Rules this review wanted and could not find");
    expect(prompt).toContain("The retro reads this list.");
  });

  it("asks the review for the verdict headings the factory parses", () => {
    const prompt = render();
    expect(prompt).toContain("## Standards: PASS | CHANGES REQUESTED");
    expect(prompt).toContain("## Spec: PASS | CHANGES REQUESTED");
  });
});
