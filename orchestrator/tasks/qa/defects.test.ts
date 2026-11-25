import { describe, expect, it } from "vitest";
import { bugDefect, DEFECT_TAG, nextDefectNumber, openDefects, parseDefect, RECHECK_TAG, renderKnownDefects } from "./defects.ts";
import { defect, factory, threaded } from "./fixtures.ts";
import { renderDefect } from "./report.ts";

const posted = (number: number, over = {}) => factory(renderDefect(number, defect(over), {}), DEFECT_TAG);

describe("parseDefect", () => {
  it("reads back what renderDefect posts", () => {
    const d = parseDefect(posted(4, { agentNotes: "spec output" }))!;
    expect(d).toMatchObject({ number: 4, severity: "High", area: "Invoices › Refunds", title: "Refunding a paid invoice twice creates two credit notes" });
    expect(d.text).toContain("**Actual:** two credit notes for the full amount");
    expect(d.text).not.toContain("Agent notes");
  });

  it("ignores comments that aren't tagged defects", () => {
    expect(parseDefect(renderDefect(4, defect(), {}))).toBeNull();
    expect(parseDefect(factory("**QA-4 · High · X**\nY", "qa coverage"))).toBeNull();
  });
});

describe("nextDefectNumber", () => {
  it("numbers on from the highest defect on the ticket", () => {
    expect(nextDefectNumber([])).toBe(1);
    expect(nextDefectNumber([threaded(posted(1)), threaded(posted(3)), threaded("Oscar's note")])).toBe(4);
  });
});

describe("openDefects", () => {
  const ticket = { id: "t1", identifier: "REC-201" };

  it("lists each defect under its reference, with where to reply", () => {
    const top = threaded(posted(4));
    expect(openDefects(ticket, [top])).toEqual([
      expect.objectContaining({ ref: "REC-201 #4", ticketId: "t1", commentId: top.id, url: top.url }),
    ]);
  });

  it("drops a defect whose latest recheck says it no longer reproduces", () => {
    const top = threaded(posted(4));
    const still = threaded(factory("Still reproduces on `main`.", RECHECK_TAG), { parentId: top.id });
    const gone = threaded(factory("No longer reproduces on `main`: fixed.", RECHECK_TAG), { parentId: top.id });
    expect(openDefects(ticket, [top, still])).toHaveLength(1);
    expect(openDefects(ticket, [top, still, gone])).toEqual([]);
    expect(openDefects(ticket, [top, gone, still])).toHaveLength(1);
  });

  it("doesn't take a reply quoting a defect for one", () => {
    const top = threaded(posted(4));
    expect(openDefects(ticket, [top, threaded(posted(5), { parentId: top.id })])).toHaveLength(1);
  });
});

describe("renderKnownDefects", () => {
  it("shows each known defect under its reference, bug tickets by their id", () => {
    const bug = bugDefect({ id: "b1", identifier: "REC-77", title: 'The "Pay" button', url: "u", description: "Steps: …" });
    expect(bug.commentId).toBeNull();
    expect(renderKnownDefects([bug])).toBe(`<known-defect ref="REC-77" title="The 'Pay' button">\nSteps: …\n</known-defect>`);
    expect(renderKnownDefects([])).toBe("None.");
  });
});
