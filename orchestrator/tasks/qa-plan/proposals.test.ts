import { describe, expect, it } from "vitest";
import { linearComment } from "../../src/logic.ts";
import { oscar } from "../../test/fixtures.ts";
import { filedByArea, latestProposals, oscarReplied, parseProposals, PROPOSALS_TAG, renderProposals, scopeDescription, toFile, type Proposals, type Scope } from "./proposals.ts";

const scope = (over: Partial<Scope> = {}): Scope => ({
  number: 1,
  area: "Portal checkout",
  interface: "UI and API",
  flows: ["Guest checkout with card, single plan"],
  releaseChanges: [],
  ownedElsewhere: [],
  accepted: false,
  ...over,
});
const proposals = (scopes: Scope[], needsHuman: string[] = []): Proposals => ({ scopes, needsHuman });
const output = (p: unknown) => JSON.stringify({ subtype: "success", structured_output: p });

describe("parseProposals", () => {
  const two = proposals([scope({ ownedElsewhere: [{ what: "Refunds", owner: 2 }] }), scope({ number: 2, area: "Billing", flows: ["Refund a paid invoice"] })]);

  it("accepts proposals whose numbers, areas and owners add up", () => {
    expect(parseProposals(output(two), false)).toEqual({ ok: true, proposals: two });
  });

  it("wants numbers and areas unique, and every owner another QA scope", () => {
    const bad = parseProposals(output(proposals([scope({ ownedElsewhere: [{ what: "Refunds", owner: 3 }] }), scope({ area: "portal checkout" })])), false);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error).toContain("Number 1 is used twice.");
      expect(bad.error).toContain("Area `portal checkout` is used twice");
      expect(bad.error).toContain("owned by 3, which isn't another QA scope");
    }
  });

  it("wants each flow in exactly one QA scope", () => {
    const bad = parseProposals(output(proposals([scope(), scope({ number: 2, area: "Billing", flows: ["guest checkout with card, single plan"] })])), false);
    expect(!bad.ok && bad.error).toContain("is in QA scopes 1 and 2");
  });

  it("accepts nothing before Oscar has replied", () => {
    const accepted = output(proposals([scope({ accepted: true })]));
    expect(parseProposals(accepted, false).ok).toBe(false);
    expect(parseProposals(accepted, true).ok).toBe(true);
  });
});

describe("filing", () => {
  const p = proposals([
    scope({ accepted: true, ownedElsewhere: [{ what: "Invoice PDFs, refunds", owner: 2 }] }),
    scope({ number: 2, area: "Billing", accepted: true, flows: ["Refund a paid invoice"] }),
    scope({ number: 3, area: "Settings", flows: ["Rename the company"] }),
  ]);

  it("files what Oscar accepted and isn't filed yet", () => {
    expect(toFile(p, { billing: { id: "b", identifier: "REC-201", url: "u", cancelled: false } }).map((s) => s.area)).toEqual(["Portal checkout"]);
  });

  it("never files one again, even cancelled, matching its title whatever the case", () => {
    const filed = filedByArea(p, [{ id: "b", identifier: "REC-201", url: "u", title: "qa: billing", state: "cancelled" }]);
    expect(filed).toEqual({ billing: { id: "b", identifier: "REC-201", url: "u", cancelled: true } });
    expect(toFile(p, filed).map((s) => s.area)).toEqual(["Portal checkout"]);
  });

  it("names each owner by its title and, once filed, its ticket", () => {
    expect(scopeDescription(p.scopes[0]!, p, "main", {})).toMatch(/- Invoice PDFs, refunds → QA: Billing$/);
    expect(scopeDescription(p.scopes[0]!, p, "main", { billing: { id: "b", identifier: "REC-201", url: "u", cancelled: false } })).toContain(
      "- Invoice PDFs, refunds → QA: Billing (REC-201)",
    );
  });

  it("posts every QA scope folded under its number, filed ones linked, then what needs a human", () => {
    const text = renderProposals(
      { ...p, needsHuman: ["Invoice emails: third-party APIs unreachable"] },
      "release/2026-11-25",
      { billing: { id: "b", identifier: "REC-201", url: "https://linear/REC-201", cancelled: false } },
      "## Decisions\n\nSplit billing from checkout.",
    );
    expect(text).toMatch(/^\*\*QA scopes\*\* for `release\/2026-11-25`: 3 proposed, 1 filed\./);
    expect(text).toContain("+++ 1. QA: Portal checkout\n\n**Branch:** release/2026-11-25");
    expect(text).toContain("+++ 2. QA: Billing · filed as REC-201\n\n[REC-201](https://linear/REC-201): its description is the QA scope now.\n\n+++");
    expect(text).toContain("+++ Run notes: the proposals as written\n\n## Decisions\n\nSplit billing from checkout.\n\n+++");
    expect(text).toContain("**Needs a human**\n\n- Invoice emails: third-party APIs unreachable");
  });
});

describe("the thread", () => {
  const posted = (at: string) => ({ body: linearComment("**QA scopes** …", "run-1", PROPOSALS_TAG), createdAt: at, isMe: true });

  it("finds the latest proposals and every reply of Oscar's since the first, not the factory's", () => {
    const comments = [oscar("Plan it.", "2026-11-25T00:00:00Z"), posted("2026-11-25T01:00:00Z"), oscar("Accept 1.", "2026-11-25T02:00:00Z"), posted("2026-11-25T03:00:00Z"), oscar("Drop 3.", "2026-11-25T04:00:00Z")];
    expect(latestProposals(comments)?.proposals.createdAt).toBe("2026-11-25T03:00:00Z");
    expect(latestProposals(comments)?.replies.map((c) => c.body)).toEqual(["Accept 1.", "Drop 3."]);
    expect(latestProposals([])).toBeNull();
  });

  it("counts Oscar as having replied once he answered any proposals", () => {
    expect(oscarReplied([posted("2026-11-25T01:00:00Z")])).toBe(false);
    expect(oscarReplied([posted("2026-11-25T01:00:00Z"), oscar("Accept 1.", "2026-11-25T02:00:00Z"), posted("2026-11-25T03:00:00Z")])).toBe(true);
    expect(oscarReplied([oscar("Please plan this.", "2026-11-25T00:00:00Z")])).toBe(false);
  });
});
