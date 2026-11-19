import { describe, expect, it } from "vitest";
import { factory, findingsComment as findings, oscar, renderPrompt } from "../../test/fixtures.ts";
import { promptVars, renderThread } from "./prompt.ts";

const render = (feedback: string | null = null, thread = "") => renderPrompt("implement", promptVars({ feedback, thread }));

describe("implement's prompt", () => {
  it("renders both modes with no placeholder left", () => {
    expect(render()).not.toMatch(/\{\{/);
    expect(render("F")).not.toMatch(/\{\{/);
    expect(render()).toContain("`oscar/rec-123-show-the-refund-date-on-invoices`");
  });

  it("has implement review and fix its own work as a numbered step", () => {
    expect(render()).toMatch(/^5\. `code-review`/m);
  });

  it("renders create mode with no feedback section", () => {
    const prompt = render();
    expect(prompt).toContain("in **create** mode");
    expect(prompt).toContain("checked out from an up-to-date `main` in every repo");
    expect(prompt).not.toContain("## Feedback for this round");
  });

  it("gives implement the explore findings after the ticket", () => {
    const prompt = render(null, "## Explore findings\n\nContext, not the spec");
    expect(prompt.indexOf("## Explore findings")).toBeGreaterThan(prompt.indexOf("## Ticket REC-123"));
    expect(prompt.indexOf("## Explore findings")).toBeLessThan(prompt.indexOf("## Run values"));
  });

  it("renders update mode with the feedback on top of the ticket, which stays the spec", () => {
    const prompt = render("#### T1: `api/a.rb:3`\n\n**Oscar:**\n\n> Rename this.");
    expect(prompt).toContain("in **update** mode");
    expect(prompt).toContain("checked out at the PR's current head");
    expect(prompt).toContain("## Feedback for this round");
    expect(prompt).toContain("The ticket is the spec in both modes.");
    expect(prompt).toContain("The ticket above is still the spec for the whole PR.");
    expect(prompt).toContain("> Rename this.");
    expect(prompt).toContain("No rebase, amend, reset or squash");
  });

  it("leaves {{ in feedback alone: values aren't templates", () => {
    expect(render("> uses {{ handlebars }}")).toContain("> uses {{ handlebars }}");
  });
});

describe("renderThread", () => {
  it("is empty when the ticket has no comments of Oscar's and was never explored", () => {
    expect(renderThread([])).toBe("");
    expect(renderThread([factory("Picked up `oscar-factory:implement`.", "2026-11-18T10:00:00Z")])).toBe("");
  });

  it("gives Oscar's comments when the ticket was never explored, and they outrank the description", () => {
    const out = renderThread([
      oscar("The toggle should be on.", "2026-11-18T10:00:00Z"),
      factory("Picked up `oscar-factory:implement`.", "2026-11-18T10:01:00Z"),
    ]);
    expect(out).toContain("## Oscar's comments");
    expect(out).toContain("where one contradicts the description, follow the comment");
    expect(out).toContain("2026-11-18:\n\n> The toggle should be on.");
    expect(out).not.toContain("## Explore findings");
    expect(out).not.toContain("Picked up");
    expect(out).not.toContain("answer their open questions");
  });

  it("gives the findings without the marker line, then all of Oscar's comments, before and after them", () => {
    const out = renderThread([
      oscar("The toggle should be on.", "2026-11-17T09:00:00Z"),
      findings("## Verdict: human-needed\n\n## Open questions\n\n- Which date?", "2026-11-18T11:00:00Z"),
      oscar("Use the invoice date.", "2026-11-18T12:00:00Z"),
    ]);
    expect(out).toContain("## Explore findings\n\nContext, not the spec");
    expect(out).toContain('<findings date="2026-11-18">\n## Verdict: human-needed');
    expect(out).not.toContain("🏭");
    expect(out.indexOf("## Oscar's comments")).toBeGreaterThan(out.indexOf("## Explore findings"));
    expect(out).toContain("Those dated after the findings (2026-11-18) answer their open questions");
    expect(out.indexOf("> The toggle should be on.")).toBeLessThan(out.indexOf("> Use the invoice date."));
  });

  it("has no comments section when Oscar hasn't commented", () => {
    expect(renderThread([findings("## Verdict: easy-call", "2026-11-18T11:00:00Z")])).not.toContain("## Oscar's comments");
  });
});
