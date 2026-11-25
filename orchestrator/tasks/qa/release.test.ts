import { describe, expect, it } from "vitest";
import { renderReleaseChanges } from "./release.ts";

const commit = (sha: string, subject: string, body = "") => ({ sha, subject, body });

describe("renderReleaseChanges", () => {
  it("lists each repo's commits with their PR and the tickets they name", () => {
    const text = renderReleaseChanges("release/2026-11-25", [
      {
        repo: "api",
        changes: {
          total: 2,
          commits: [
            commit("a".repeat(40), "Merge pull request #1234 from bunnyapp/rec-88-prorate", "REC-88: Prorate on plan change"),
            commit("b".repeat(40), "Fix the invoice total (#1230)", "Closes REC-90"),
          ],
        },
      },
      { repo: "kong", changes: { total: 0, commits: [] } },
      { repo: "docs", changes: null },
    ]);
    expect(text).toBe(
      [
        "What `release/2026-11-25` adds to `production`, newest first.",
        "",
        "### api (2 commits)",
        "",
        "- `aaaaaaa` REC-88: Prorate on plan change (#1234)",
        "- `bbbbbbb` Fix the invoice total (#1230) · REC-90",
      ].join("\n"),
    );
  });

  it("says how many older commits it left out", () => {
    const text = renderReleaseChanges("main", [{ repo: "app", changes: { total: 3, commits: [commit("c".repeat(40), "One")] } }]);
    expect(text).toContain("### app (3 commits)");
    expect(text).toContain("- … and 2 older");
  });

  it("makes a run on production, or on a branch that adds nothing, a whole-area run", () => {
    expect(renderReleaseChanges("production", [])).toMatch(/whole-area run/);
    expect(renderReleaseChanges("main", [{ repo: "api", changes: { total: 0, commits: [] } }])).toMatch(/adds nothing.*whole-area run/);
  });
});
