import { describe, expect, it } from "vitest";
import { findingsComment, oscar, renderPrompt } from "../../test/fixtures.ts";
import { promptVars, type PrContext } from "./prompt.ts";

const pr = (over: Partial<PrContext> = {}): PrContext => ({
  repo: "app",
  url: "https://github.com/bunnyapp/app/pull/3534",
  ci: { state: "green", failing: [], pending: [], checks: 3 },
  body: "Fixes the tag colour.\n\n## Decisions\n\n- Kept the old prop.\n\n<!-- oscar-factory -->",
  reviews: [{ repo: "app", author: "oluthje", body: "## Standards: PASS\n\n## Spec: PASS", createdAt: "2026-11-19T10:00:00Z" }],
  comments: [],
  threads: [
    {
      id: "t1",
      repo: "app",
      path: "src/Tag.tsx",
      line: 12,
      isResolved: false,
      comments: [{ author: "oluthje", body: "Why green here?", createdAt: "2026-11-19T11:00:00Z" }],
    },
    { id: "t2", repo: "app", path: "src/Old.tsx", line: 3, isResolved: true, comments: [{ author: "oluthje", body: "Settled.", createdAt: "2026-11-19T11:00:00Z" }] },
  ],
  ...over,
});

const render = (prs: PrContext[] = [pr()], comments = [oscar("Use the brand green.", "2026-11-19T09:00:00Z")]) =>
  renderPrompt("merge", promptVars({ prs, ticketComments: comments }));

describe("merge's prompt", () => {
  it("renders with no placeholder left", () => {
    expect(render()).not.toMatch(/\{\{/);
  });

  it("starts with the rules, then the rubric, and writes the verdict for the factory to merge", () => {
    const prompt = render();
    expect(prompt).toMatch(/^1\. `factory-rules`/m);
    expect(prompt).toContain("`/home/daytona/run/rubric.md`");
    expect(prompt).toContain("Verdict path: `/home/daytona/artifacts/merge-verdict.md`");
    expect(prompt).toContain("You changed nothing: no commits");
  });

  it("gives each PR its CI, body without the marker, reviews and unresolved threads only", () => {
    const prompt = render();
    expect(prompt).toContain("### app: https://github.com/bunnyapp/app/pull/3534\n\nCI: green (3 checks)");
    expect(prompt).toContain("- Kept the old prop.");
    expect(prompt).not.toContain("<!-- oscar-factory -->");
    expect(prompt).toContain("## Standards: PASS");
    expect(prompt).toContain("`src/Tag.tsx:12`");
    expect(prompt).toContain("Why green here?");
    expect(prompt).not.toContain("Settled.");
  });

  it("says when CI had no checks to run, so the agent weighs the missing evidence", () => {
    expect(render([pr({ ci: { state: "green", failing: [], pending: [], checks: 0 } })])).toContain("CI: green, but no checks ran on this PR");
  });

  it("gives Oscar's ticket comments and the explore findings", () => {
    const prompt = render([pr()], [findingsComment("## Verdict: easy-call\n\nClear.", "2026-11-18T09:00:00Z"), oscar("Use the brand green.", "2026-11-19T09:00:00Z")]);
    expect(prompt).toContain("## Explore findings");
    expect(prompt).toContain("## Verdict: easy-call");
    expect(prompt).toContain("## Oscar's comments");
    expect(prompt).toContain("Use the brand green.");
  });
});
