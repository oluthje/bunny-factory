import { describe, expect, it } from "vitest";
import {
  advanceCursor,
  asDaytona,
  isFactoryComment,
  linearComment,
  parseChangedRepos,
  prBody,
  prTitle,
  reviewComment,
  sandboxName,
  selectNewTickets,
  shQuote,
  type Ticket,
} from "../src/logic.ts";

const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  id: "uuid-1",
  identifier: "REC-123",
  title: "Show the refund date on invoices",
  description: "Invoices should show when they were refunded.",
  url: "https://linear.app/bunnyinc/issue/REC-123",
  branchName: "oscar/rec-123-show-the-refund-date-on-invoices",
  labels: ["oscar-factory:implement"],
  updatedAt: "2026-11-18T10:00:00.000Z",
  ...over,
});

describe("selectNewTickets", () => {
  it("drops tickets that are busy", () => {
    const a = ticket({ id: "a" });
    const b = ticket({ id: "b" });
    expect(selectNewTickets([a, b], (t) => t.id === "a")).toEqual([b]);
  });

  it("drops duplicates within one page", () => {
    const a = ticket({ id: "a" });
    expect(selectNewTickets([a, a], () => false)).toEqual([a]);
  });
});

describe("advanceCursor", () => {
  it("moves to the newest updatedAt", () => {
    const issues = [
      ticket({ updatedAt: "2026-11-18T10:00:00.000Z" }),
      ticket({ updatedAt: "2026-11-18T12:00:00.000Z" }),
    ];
    expect(advanceCursor("2026-11-18T09:00:00.000Z", issues)).toBe("2026-11-18T12:00:00.000Z");
  });

  it("never moves backwards", () => {
    expect(advanceCursor("2026-11-18T13:00:00.000Z", [ticket()])).toBe("2026-11-18T13:00:00.000Z");
  });

  it("keeps the cursor when there are no issues", () => {
    expect(advanceCursor(null, [])).toBeNull();
    expect(advanceCursor("2026-11-18T13:00:00.000Z", [])).toBe("2026-11-18T13:00:00.000Z");
  });
});

describe("sandboxName", () => {
  it("is lowercase, prefixed and unique per run", () => {
    expect(sandboxName("REC-123", "01JABCDEFXYZ")).toBe("oscar-factory-rec-123-01jabcde");
  });
});

describe("shell helpers", () => {
  it("quotes single quotes safely", () => {
    expect(shQuote("it's")).toBe(`'it'\\''s'`);
  });

  it("runs commands as the daytona user in a login shell from home", () => {
    expect(asDaytona("echo hi")).toBe(`sudo -E -u daytona -H bash -lc 'cd ~ && echo hi'`);
  });
});

describe("parseChangedRepos", () => {
  it("keeps repos with at least one new commit", () => {
    expect(parseChangedRepos("api 2\napp 0\nportal 1\n\nkong 0\n")).toEqual([
      { repo: "api", commits: 2 },
      { repo: "portal", commits: 1 },
    ]);
  });

  it("ignores junk lines", () => {
    expect(parseChangedRepos("warning: something\napi 3")).toEqual([{ repo: "api", commits: 3 }]);
  });
});

describe("PR and Linear text", () => {
  it("titles the PR with the ticket", () => {
    expect(prTitle(ticket())).toBe("REC-123: Show the refund date on invoices");
  });

  it("links the ticket and includes the agent's body in the PR body", () => {
    const body = prBody(ticket(), "Added the date.", "run-1");
    expect(body).toContain("https://linear.app/bunnyinc/issue/REC-123");
    expect(body).toContain("Added the date.");
    expect(body).toContain("run-1");
  });

  it("marks factory comments so pollers can skip them", () => {
    const body = linearComment("Opened PRs", "run-1");
    expect(isFactoryComment(body)).toBe(true);
    expect(isFactoryComment("A human comment")).toBe(false);
  });
});

describe("reviewComment", () => {
  it("frames the review with the ticket and run, and says it is comment only", () => {
    const body = reviewComment(ticket(), "## Standards\n\nFine.\n", "run-1");
    expect(body).toContain("[REC-123](https://linear.app/bunnyinc/issue/REC-123)");
    expect(body).toContain("## Standards\n\nFine.");
    expect(body).toContain("run `run-1`");
    expect(body).toContain("no approval or change request");
  });
});
