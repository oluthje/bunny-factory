import { describe, expect, it } from "vitest";
import { ticket } from "../../test/fixtures.ts";
import { prBody, prTitle } from "./pr.ts";

describe("the PR", () => {
  it("titles the PR with the ticket", () => {
    expect(prTitle(ticket())).toBe("REC-123: Show the refund date on invoices");
  });

  it("links the ticket and includes the agent's body in the PR body", () => {
    const body = prBody(ticket(), "Added the date.", "run-1");
    expect(body).toContain("https://linear.app/bunnyinc/issue/REC-123");
    expect(body).toContain("Added the date.");
    expect(body).toContain("run-1");
  });
});
