import { describe, expect, it } from "vitest";
import { ciState, type CheckRun, type CommitStatus } from "../src/checks.ts";

const run = (name: string, status: string, conclusion: string | null = null): CheckRun => ({ name, status, conclusion });
const status = (context: string, state: string): CommitStatus => ({ context, state });

describe("ciState", () => {
  it("is green when every check run passed, was skipped or neutral, and every status succeeded", () => {
    expect(
      ciState({
        runs: [run("build", "completed", "success"), run("lint", "completed", "skipped"), run("info", "completed", "neutral")],
        statuses: [status("deploy/preview", "success")],
      }),
    ).toEqual({ state: "green", failing: [], pending: [], checks: 4 });
  });

  it("is green with no checks at all, and says there were none", () => {
    expect(ciState({ runs: [], statuses: [] })).toEqual({ state: "green", failing: [], pending: [], checks: 0 });
  });

  it("is pending while a check run hasn't finished or a status is pending", () => {
    expect(ciState({ runs: [run("build", "in_progress"), run("rspec", "queued")], statuses: [status("ci", "pending")] })).toEqual({
      state: "pending",
      failing: [],
      pending: ["build", "rspec", "ci"],
      checks: 3,
    });
  });

  it("is red when any check failed, even with others still running", () => {
    const s = ciState({
      runs: [
        run("build", "completed", "failure"),
        run("rspec", "in_progress"),
        run("cancelled", "completed", "cancelled"),
        run("slow", "completed", "timed_out"),
        run("gate", "completed", "action_required"),
      ],
      statuses: [status("legacy", "error"), status("other", "failure")],
    });
    expect(s.state).toBe("red");
    expect(s.failing).toEqual(["build", "cancelled", "slow", "gate", "legacy", "other"]);
  });

  it("combines several commits: red beats pending beats green", () => {
    const green = ciState({ runs: [run("a", "completed", "success")], statuses: [] });
    const pending = ciState({ runs: [run("b", "queued")], statuses: [] });
    const red = ciState({ runs: [run("c", "completed", "failure")], statuses: [] });
    expect(ciState.combine([green, pending]).state).toBe("pending");
    expect(ciState.combine([green, pending, red])).toEqual({ state: "red", failing: ["c"], pending: ["b"], checks: 3 });
    expect(ciState.combine([green, green]).state).toBe("green");
  });
});
