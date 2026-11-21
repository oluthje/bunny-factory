import { describe, expect, it } from "vitest";
import { linearComment } from "../../src/logic.ts";
import { factory, oscar } from "../../test/fixtures.ts";
import { CONCLUSION_TAG, conclusionReport, conclusionText, latestConclusion, parseRefuteResult, recommendation } from "./conclusion.ts";

const result = (output: unknown) => JSON.stringify({ structured_output: output });
const conclusion = (text: string, createdAt: string) => ({ body: linearComment(text, "run-1", CONCLUSION_TAG), createdAt, isMe: true });

describe("parseRefuteResult", () => {
  it("reads each verdict", () => {
    expect(parseRefuteResult(result({ verdict: "do-it", summary: "Do it.", condition: "" }))).toEqual({ ok: true, verdict: "do-it", summary: "Do it.", condition: "" });
    expect(parseRefuteResult(result({ verdict: "dont", summary: "Don't.", condition: "" }))).toMatchObject({ ok: true, verdict: "dont" });
  });

  it("wants a condition with not-yet: without one a later scan can't tell when to bring it back", () => {
    expect(parseRefuteResult(result({ verdict: "not-yet", summary: "Wait.", condition: " " }))).toEqual({
      ok: false,
      error: "The verdict pass's verdict is invalid: not-yet needs its condition.",
    });
    expect(parseRefuteResult(result({ verdict: "not-yet", summary: "Wait.", condition: "A second adapter exists." }))).toMatchObject({ ok: true });
  });

  it("refuses a verdict it doesn't know, and an empty result", () => {
    expect(parseRefuteResult(result({ verdict: "maybe", summary: "x", condition: "" }))).toMatchObject({ ok: false });
    expect(parseRefuteResult("")).toEqual({ ok: false, error: "The verdict pass wrote no result." });
  });
});

describe("the conclusion comment", () => {
  const body = conclusionReport({
    head: "Refuted: **not yet**.",
    reportUrl: "https://uploads.linear.app/r.html",
    summary: "Right idea, too early.",
    identifier: "REC-10",
    conclusion: "## Verdict: not yet\n\nWait until a second adapter exists\nbehind the seam.\n\n## Claims\n\nAll hold.",
  });

  it("opens with the verdict and the command to run next, then the report and the summary, with the conclusion folded", () => {
    expect(body.startsWith("Refuted: **not yet**.\n\n**Next:** run `/factory-deepen-grill REC-10` in bunny-factory to decide.")).toBe(true);
    expect(body).toContain("[📄 The report (HTML)");
    expect(body).toContain("Right idea, too early.");
    expect(body).toContain("`/factory-deepen-grill REC-10`");
    expect(body).toContain("`oscar-factory:deepen-refute`");
    expect(body).toContain("+++ Full conclusion\n\n## Verdict: not yet");
  });

  it("goes without the report link when the upload failed", () => {
    expect(conclusionReport({ head: "h", reportUrl: null, summary: "", identifier: "REC-10", conclusion: "c" })).not.toContain("📄");
  });

  it("is found again by its tag, the latest one, past failure notes and Oscar's comments", () => {
    const comments = [
      conclusion("## Verdict: don't\n\nOld.", "2026-11-20T10:00:00Z"),
      oscar("You missed the second adapter.", "2026-11-20T11:00:00Z"),
      conclusion(`${body}\n\nWaiting on Oscar.`, "2026-11-20T12:00:00Z"),
      factory("The run failed.", "2026-11-20T13:00:00Z"),
    ];
    const latest = latestConclusion(comments)!;
    expect(latest.createdAt).toBe("2026-11-20T12:00:00Z");
    expect(conclusionText(latest.body)).toBe("## Verdict: not yet\n\nWait until a second adapter exists\nbehind the seam.\n\n## Claims\n\nAll hold.");
    expect(recommendation(latest.body)).toEqual({ verdict: "not yet", why: "Wait until a second adapter exists behind the seam." });
    expect(latestConclusion([oscar("hi", "2026-11-20T11:00:00Z")])).toBeNull();
  });

  it("has no recommendation without the heading", () => {
    expect(recommendation(linearComment("Timed out.", "run-1", CONCLUSION_TAG))).toBeNull();
  });
});
