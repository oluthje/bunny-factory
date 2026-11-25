import { describe, expect, it } from "vitest";
import { linearComment } from "../../src/logic.ts";
import { oscar, renderPrompt } from "../../test/fixtures.ts";
import { PROPOSALS_TAG } from "./proposals.ts";
import { PROPOSALS, promptVars, renderThread } from "./prompt.ts";

describe("qa-plan's prompt", () => {
  it("fills every placeholder", () => {
    const prompt = renderPrompt("qa-plan", promptVars({ thread: "THREAD", releaseChanges: "RELEASE", knownDefects: "KNOWN", runnerGaps: "GAPS" }));
    for (const s of ["THREAD", "RELEASE", "KNOWN", "GAPS", `Proposals path: \`${PROPOSALS}\``]) expect(prompt).toContain(s);
  });

  it("tells a first run to accept nothing", () => {
    expect(renderThread([], [])).toMatch(/first run\. Propose, and accept nothing/);
  });

  it("gives a later run the last proposals, Oscar's replies and what's filed", () => {
    const comments = [
      { body: linearComment("**QA scopes** for `main`: 2 proposed, 0 filed.", "run-1", PROPOSALS_TAG), createdAt: "2026-11-25T01:00:00Z", isMe: true },
      oscar("Accept 1, 2. For 2 also cover coupon stacking.", "2026-11-25T02:00:00Z"),
    ];
    const thread = renderThread(comments, [{ identifier: "REC-201", title: "QA: Billing", state: "open" }, { identifier: "REC-202", title: "QA: Settings", state: "cancelled" }]);
    expect(thread).toContain('<proposals date="2026-11-25">\n**QA scopes** for `main`: 2 proposed, 0 filed.\n</proposals>');
    expect(thread).toContain("> Accept 1, 2. For 2 also cover coupon stacking.");
    expect(thread).toContain("- REC-201: QA: Billing\n- REC-202: QA: Settings (cancelled)");
  });
});
