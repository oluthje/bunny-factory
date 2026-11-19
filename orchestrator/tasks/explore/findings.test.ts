import { describe, expect, it } from "vitest";
import { factory, findingsComment as findings, oscar } from "../../test/fixtures.ts";
import { handOff, latestFindings, parseExploreVerdict } from "./findings.ts";

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

describe("parseExploreVerdict", () => {
  const result = (structured_output: unknown) => JSON.stringify({ type: "result", subtype: "success", structured_output });

  it("reads a verdict", () => {
    expect(parseExploreVerdict(result({ verdict: "easy-call" }))).toEqual({ ok: true, verdict: "easy-call" });
  });

  it("rejects a verdict outside the two", () => {
    expect(parseExploreVerdict(result({ verdict: "blocked" })).ok).toBe(false);
  });

  it("explains an empty result with stderr", () => {
    expect(parseExploreVerdict("", "boom")).toEqual({ ok: false, error: "The verdict pass wrote no result: boom" });
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
