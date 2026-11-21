import { describe, expect, it } from "vitest";
import { renderPrompt } from "../../test/fixtures.ts";
import { promptVars } from "./prompt.ts";

describe("deepen-scan's prompt", () => {
  it("renders read-only on origin/main, with both paths, the earlier candidates, the shape and the cap", () => {
    const prompt = renderPrompt("deepen-scan", promptVars("- **Invoice totals** (REC-1, open)"));
    expect(prompt).not.toMatch(/\{\{/);
    expect(prompt).toContain("at `origin/main`, detached");
    expect(prompt).toContain("Candidates path: `/home/daytona/artifacts/candidates.md`");
    expect(prompt).toContain("Report path: `/home/daytona/artifacts/scan-report.html`");
    expect(prompt).toContain("- **Invoice totals** (REC-1, open)");
    expect(prompt).toContain("**Strength:** Strong | Worth exploring | Speculative");
    expect(prompt).toContain("Only the first 3 `Strong` candidates get a ticket");
  });

  it("reads the upstream skill by path, since the Skill tool won't load it", () => {
    expect(renderPrompt("deepen-scan", promptVars(""))).toContain("~/.claude/skills/improve-codebase-architecture/SKILL.md");
  });
});
