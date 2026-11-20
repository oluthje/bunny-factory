import { describe, expect, it } from "vitest";
import { ticket } from "../../test/fixtures.ts";
import { ciStopText, mergedText, notMergingText, partialText, prNote, wouldMergeText } from "./report.ts";

const api = "https://github.com/bunnyapp/api/pull/7429";
const app = "https://github.com/bunnyapp/app/pull/3534";
const urls = { api, app };

describe("ciStopText", () => {
  it("names the failing checks", () => {
    expect(ciStopText({ state: "red", failing: ["build"], pending: [], checks: 2 }, 30)).toBe("Not merging: CI failed: build.");
  });

  it("names what was still running when the wait ran out", () => {
    expect(ciStopText({ state: "pending", failing: [], pending: ["rspec"], checks: 2 }, 30)).toBe(
      "Not merging: CI was still running after 30 minutes: rspec.",
    );
  });
});

describe("notMergingText", () => {
  it("gives the agent's summary, each held-back PR's reason, and every blocker", () => {
    const text = notMergingText({
      summary: "The app half changes a shared hook.",
      holdouts: [{ repo: "app", verdict: "human-needed", reason: "Touches useGQLMutation." }],
      blockers: ["api: CI failed: build."],
      urls,
    });
    expect(text).toBe(
      [
        "Not merging. The app half changes a shared hook.",
        "",
        "- [bunnyapp/app#3534](https://github.com/bunnyapp/app/pull/3534): Touches useGQLMutation.",
        "- api: CI failed: build.",
      ].join("\n"),
    );
  });
});

describe("wouldMergeText", () => {
  it("says what it would merge, in order, and that nothing merged", () => {
    expect(wouldMergeText("Small fix, tested.", ["api", "app"], urls)).toBe(
      "🤖 Dry run: would auto-merge [bunnyapp/api#7429](https://github.com/bunnyapp/api/pull/7429), then [bunnyapp/app#3534](https://github.com/bunnyapp/app/pull/3534). Small fix, tested.\n\nMerging is off (`FACTORY_MERGE_DRY_RUN`), so nothing merged.",
    );
  });
});

describe("mergedText", () => {
  it("says what merged, in order", () => {
    expect(mergedText("Small fix, tested.", ["api", "app"], urls)).toBe(
      "Auto-merged [bunnyapp/api#7429](https://github.com/bunnyapp/api/pull/7429), then [bunnyapp/app#3534](https://github.com/bunnyapp/app/pull/3534). Small fix, tested.",
    );
  });
});

describe("partialText", () => {
  it("says what merged, what failed and why, and what's left to finish by hand", () => {
    expect(partialText({ merged: ["api"], failed: { repo: "app", error: "Head branch was modified." }, rest: [], urls })).toBe(
      "⚠️ Partial auto-merge: [bunnyapp/api#7429](https://github.com/bunnyapp/api/pull/7429) merged; [bunnyapp/app#3534](https://github.com/bunnyapp/app/pull/3534) NOT merged: Head branch was modified. Finish by hand.",
    );
  });

  it("says nothing merged, not a partial merge, when the first merge fails", () => {
    expect(partialText({ merged: [], failed: { repo: "api", error: "409" }, rest: [], urls })).toBe(
      "⚠️ Auto-merge failed: nothing merged; [bunnyapp/api#7429](https://github.com/bunnyapp/api/pull/7429) NOT merged: 409. Finish by hand.",
    );
  });

  it("lists PRs it never got to", () => {
    expect(partialText({ merged: [], failed: { repo: "api", error: "409" }, rest: ["app"], urls })).toContain(
      "Not tried: [bunnyapp/app#3534](https://github.com/bunnyapp/app/pull/3534).",
    );
  });
});

describe("prNote", () => {
  it("frames the text for a PR comment, with the ticket link and the factory's marker", () => {
    expect(prNote(ticket(), "Not merging.", "run-1")).toBe(
      "Factory merge check of [REC-123](https://linear.app/bunnyinc/issue/REC-123) (run `run-1`).\n\nNot merging.\n\n<!-- oscar-factory -->",
    );
  });
});
