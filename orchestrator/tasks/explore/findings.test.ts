import { describe, expect, it } from "vitest";
import { factory, findingsComment as findings, oscar } from "../../test/fixtures.ts";
import { findingsText, handOff, latestFindings, parseExploreResult } from "./findings.ts";

describe("latestFindings", () => {
  it("finds the last findings comment and Oscar's own comments after it", () => {
    const comments = [
      findings("## Verdict: human-needed\n\nOld.", "2026-11-18T09:00:00Z"),
      oscar("Before the latest findings.", "2026-11-18T10:00:00Z"),
      findings("## Verdict: human-needed\n\nNew.", "2026-11-18T11:00:00Z"),
      factory("Picked up `oscar-factory:implement`.", "2026-11-18T11:30:00Z"),
      oscar("Use the invoice date.", "2026-11-18T12:00:00Z"),
      { body: "A teammate's comment.", createdAt: "2026-11-18T12:30:00Z", isMe: false },
    ];
    const latest = latestFindings(comments)!;
    expect(latest.findings.body).toContain("New.");
    expect(latest.answers.map((c) => c.body)).toEqual(["Use the invoice date."]);
  });

  it("is null when the ticket was never explored, even with other factory comments", () => {
    expect(latestFindings([factory("The run failed.", "2026-11-18T09:00:00Z"), oscar("Hi", "2026-11-18T10:00:00Z")])).toBeNull();
  });
});

describe("parseExploreResult", () => {
  const result = (structured_output: unknown) => JSON.stringify({ type: "result", subtype: "success", structured_output });

  it("reads a verdict and its questions", () => {
    expect(parseExploreResult(result({ verdict: "easy-call", questions: [] }))).toEqual({ ok: true, verdict: "easy-call", questions: [] });
  });

  it("rejects a verdict outside the two", () => {
    expect(parseExploreResult(result({ verdict: "blocked", questions: [] })).ok).toBe(false);
  });

  it("rejects a result without questions", () => {
    expect(parseExploreResult(result({ verdict: "human-needed" }))).toMatchObject({ ok: false, error: /questions/ });
  });

  it("explains an empty result with stderr", () => {
    expect(parseExploreResult("", "boom")).toEqual({ ok: false, error: "The verdict pass wrote no result: boom" });
  });
});

describe("handOff", () => {
  it("hands an easy call to implement", () => {
    expect(handOff("easy-call")).toBe("implement");
  });

  it("waits on Oscar when the run needs him or gave no verdict", () => {
    expect(handOff("human-needed")).toBeNull();
    expect(handOff(null)).toBeNull();
  });
});

describe("findingsText", () => {
  const marker = "🏭 oscar-factory · run `r1` · explore findings\n\n";

  it("takes the findings out of their fold, without the head line, the cards or the hand-off line", () => {
    const body = `${marker}Explored: Answer, then add \`oscar-factory:implement\`.\n\n### Q1 · Keep it?\n\n+++ No → B. Drop it · None\n\nGone.\n\n+++\n\n+++ Full findings\n\n## Verdict: human-needed\n\nWhy.\n\n+++\n\nWaiting on Oscar.`;
    expect(findingsText(body)).toBe("## Verdict: human-needed\n\nWhy.");
  });

  it("takes everything from the verdict on when the findings aren't folded", () => {
    expect(findingsText(`${marker}Explored: **needs Oscar**.\n\n## Verdict: human-needed\n\nWhy.\n\nWaiting on Oscar.`)).toBe(
      "## Verdict: human-needed\n\nWhy.\n\nWaiting on Oscar.",
    );
  });

  it("keeps a comment without a verdict whole, without its marker line", () => {
    expect(findingsText(`${marker}Timed out.`)).toBe("Timed out.");
  });
});
