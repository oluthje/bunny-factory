import { describe, expect, it } from "vitest";
import { renderStatus, type StatusInput } from "../src/status.ts";

const GB = 1024 ** 3;
const now = new Date("2026-11-20T12:00:00.000Z");
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

const input = (over: Partial<StatusInput> = {}): StatusInput => ({
  now,
  state: "running",
  polling: true,
  deploy: { commit: "276d003abcdef", at: ago(120) },
  maxRuns: 3,
  inFlight: [],
  recent: [],
  lastPolledAt: ago(0.5),
  disk: { total: 40 * GB, free: 30 * GB },
  patExpires: "2026-12-17",
  snapshot: { name: "bunny-agent-1", createdAt: ago(3 * 24 * 60) },
  ...over,
});

const lineWith = (text: string, needle: string) => text.split("\n").find((l) => l.includes(needle)) ?? "";

describe("renderStatus", () => {
  it("shows the state and the deployed commit with its age", () => {
    const out = renderStatus(input());
    expect(lineWith(out, "State")).toContain("running");
    expect(lineWith(out, "State")).toContain("276d003");
    expect(lineWith(out, "State")).toContain("2h ago");
  });

  it("shows draining with how many runs are left", () => {
    const run = { ticket: "REC-1", task: "implement", step: "claude-poll-3", createdAt: ago(12) };
    const out = renderStatus(input({ state: "stopped", inFlight: [run, { ...run, ticket: "REC-2" }] }));
    expect(lineWith(out, "State")).toContain("draining (2 runs left)");
  });

  it("lists each run in flight with its ticket, task, step and time elapsed, out of the most allowed", () => {
    const out = renderStatus(input({ inFlight: [{ ticket: "REC-1", task: "review", step: "create-sandbox", createdAt: ago(75) }] }));
    expect(lineWith(out, "In flight")).toContain("1 of 3");
    const row = lineWith(out, "REC-1");
    expect(row).toContain("review");
    expect(row).toContain("create-sandbox");
    expect(row).toContain("1h 15m");
  });

  it("lists finished runs with outcome, duration and PR link", () => {
    const out = renderStatus(
      input({
        recent: [
          {
            ticket: "REC-9",
            task: "implement",
            status: "succeeded",
            createdAt: ago(60),
            finishedAt: ago(20),
            prUrls: ["https://github.com/bunnyapp/app/pull/12"],
          },
        ],
      }),
    );
    const row = lineWith(out, "REC-9");
    expect(row).toContain("succeeded");
    expect(row).toContain("40m");
    expect(row).toContain("https://github.com/bunnyapp/app/pull/12");
  });

  it("warns when Linear hasn't been polled for over 5 minutes", () => {
    expect(lineWith(renderStatus(input({ lastPolledAt: ago(4) })), "Linear")).not.toContain("⚠");
    expect(lineWith(renderStatus(input({ lastPolledAt: ago(6) })), "Linear")).toContain("⚠");
  });

  it("doesn't warn about polling while the factory is stopped, since it isn't meant to poll", () => {
    const line = lineWith(renderStatus(input({ state: "stopped", lastPolledAt: ago(600) })), "Linear");
    expect(line).not.toContain("⚠");
    expect(line).toContain("stopped");
  });

  it("shows disk used out of the volume, and warns when sweep-runs can't free enough", () => {
    expect(lineWith(renderStatus(input()), "Disk")).toContain("10.0 of 40.0 GB");
    expect(lineWith(renderStatus(input()), "Disk")).not.toContain("⚠");
    expect(lineWith(renderStatus(input({ disk: { total: 40 * GB, free: 6 * GB } })), "Disk")).toContain("⚠");
  });

  it("counts the days until the GitHub PAT expires", () => {
    expect(lineWith(renderStatus(input()), "PAT")).toContain("27 days");
  });

  it("shows the snapshot's age, or why it couldn't be read", () => {
    expect(lineWith(renderStatus(input()), "Snapshot")).toContain("3 days old");
    expect(lineWith(renderStatus(input({ snapshot: { error: "not found" } })), "Snapshot")).toContain("⚠ not found");
  });

  it("fits on one screen with a full page of runs", () => {
    const run = { ticket: "REC-1", task: "implement", step: "x", createdAt: ago(5) };
    const done = { ...run, status: "failed", finishedAt: ago(1), prUrls: null };
    const out = renderStatus(input({ inFlight: [run, run, run], recent: Array(10).fill(done) }));
    expect(out.split("\n").length).toBeLessThanOrEqual(30);
  });
});
