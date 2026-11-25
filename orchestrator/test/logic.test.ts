import { describe, expect, it } from "vitest";
import {
  advanceCursor,
  blockedBy,
  nowUnblocked,
  commentText,
  cursorAfterPoll,
  decideRuns,
  asDaytona,
  hasCommentTag,
  inlineEvidence,
  isFactoryComment,
  isLostRun,
  mayStartRuns,
  factoryMode,
  runFoldersToPrune,
  leftoverSandboxes,
  linearComment,
  parseChangedRepos,
  sandboxName,
  selectNewTickets,
  shQuote,
  staleCheckoutRefusal,
} from "../src/logic.ts";
import { ticket } from "./fixtures.ts";


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

describe("cursorAfterPoll", () => {
  const older = ticket({ id: "a", updatedAt: "2026-11-18T10:00:00.000Z" });
  const waiting = ticket({ id: "b", updatedAt: "2026-11-18T11:00:00.000Z" });
  const newer = ticket({ id: "c", updatedAt: "2026-11-18T12:00:00.000Z" });

  it("stops short of the ticket left waiting, so the next pass fetches it again", () => {
    expect(cursorAfterPoll("2026-11-18T09:00:00.000Z", [older, waiting, newer], waiting)).toBe(older.updatedAt);
  });

  it("stays put when the oldest ticket is the one waiting", () => {
    expect(cursorAfterPoll("2026-11-18T09:00:00.000Z", [waiting, newer], waiting)).toBe("2026-11-18T09:00:00.000Z");
  });

  it("does not pass a ticket updated at the same moment as the waiting one", () => {
    const tie = ticket({ id: "d", updatedAt: waiting.updatedAt });
    expect(cursorAfterPoll(null, [older, tie, waiting], waiting)).toBe(older.updatedAt);
  });

  it("moves to the newest ticket when nothing waits", () => {
    expect(cursorAfterPoll(null, [older, waiting, newer], null)).toBe(newer.updatedAt);
  });
});

describe("comment tags", () => {
  it("tags a factory comment on its marker line, and reads the tag back", () => {
    const body = linearComment("## Verdict: easy-call", "run-1", "explore findings");
    expect(body.split("\n")[0]).toBe("🏭 oscar-factory · run `run-1` · explore findings");
    expect(hasCommentTag(body, "explore findings")).toBe(true);
    expect(hasCommentTag(linearComment("Picked up.", "run-1"), "explore findings")).toBe(false);
    expect(hasCommentTag("explore findings", "explore findings")).toBe(false);
  });

  it("gives a factory comment's text without its marker line", () => {
    expect(commentText(linearComment("Hello\n\nWorld", "run-1", "explore findings"))).toBe("Hello\n\nWorld");
    expect(commentText(" A human comment ")).toBe("A human comment");
  });
});

describe("inlineEvidence", () => {
  it("points evidence images at their uploaded URLs, and marks the missing ones", () => {
    const body = "![Now](/home/daytona/artifacts/evidence/now.png) and ![Gone](evidence/gone.png)";
    expect(inlineEvidence(body, { "now.png": "https://uploads.linear.app/now" })).toBe(
      "![Now](https://uploads.linear.app/now) and Gone _(not captured)_",
    );
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

describe("Linear text", () => {
  it("marks factory comments so the factory can skip them", () => {
    const body = linearComment("Opened PRs", "run-1");
    expect(isFactoryComment(body)).toBe(true);
    expect(isFactoryComment("A human comment")).toBe(false);
  });
});

describe("decideRuns", () => {
  const at = (id: string, hour: number) => ({ ticket: ticket({ id, updatedAt: `2026-11-18T${String(hour).padStart(2, "0")}:00:00.000Z` }), task: "implement" });
  const outcomes = (d: { ticket: { id: string }; outcome: string }[]) => d.map((x) => `${x.ticket.id}:${x.outcome}`);
  const never = () => false;

  it("starts up to the free slots, oldest first, and the rest wait", () => {
    expect(outcomes(decideRuns([at("c", 12), at("a", 10), at("b", 11)], 2, never))).toEqual(["a:started", "b:started", "c:waiting"]);
  });

  it("starts nothing when every slot is taken, or more are in flight than the cap", () => {
    expect(outcomes(decideRuns([at("a", 10)], 0, never))).toEqual(["a:waiting"]);
    expect(outcomes(decideRuns([at("a", 10)], -1, never))).toEqual(["a:waiting"]);
  });

  it("gives a capped ticket no slot", () => {
    expect(outcomes(decideRuns([at("a", 10), at("b", 11)], 1, (t) => t.id === "a"))).toEqual(["a:capped", "b:started"]);
  });
});

describe("staleCheckoutRefusal", () => {
  it("starts from a checkout that is up to date", () => {
    expect(staleCheckoutRefusal(0, "main", false)).toBeNull();
  });
  it("refuses a checkout behind its upstream, naming the count and the way out", () => {
    const refusal = staleCheckoutRefusal(2, "main", false);
    expect(refusal).toContain("2 commits behind origin/main");
    expect(refusal).toContain("FACTORY_ALLOW_STALE=1");
  });
  it("starts anyway when told to", () => {
    expect(staleCheckoutRefusal(2, "main", true)).toBeNull();
  });
});

describe("isLostRun", () => {
  const now = new Date("2026-11-20T12:00:00Z");

  it("judges a run by its heartbeat", () => {
    expect(isLostRun({ createdAt: "2026-11-20T10:00:00Z", lastSeenAt: "2026-11-20T11:45:00Z" }, now, 30)).toBe(false);
    expect(isLostRun({ createdAt: "2026-11-20T10:00:00Z", lastSeenAt: "2026-11-20T11:29:00Z" }, now, 30)).toBe(true);
  });

  it("judges a run that never started by its creation", () => {
    expect(isLostRun({ createdAt: "2026-11-20T11:50:00Z", lastSeenAt: null }, now, 30)).toBe(false);
    expect(isLostRun({ createdAt: "2026-11-20T11:00:00Z", lastSeenAt: null }, now, 30)).toBe(true);
  });
});

describe("leftoverSandboxes", () => {
  it("deletes only sandboxes of runs this orchestrator knows and has finished", () => {
    const sandboxes = [
      { id: "done", runId: "r1" },
      { id: "live", runId: "r2" },
      { id: "queued", runId: "r3" },
      { id: "foreign", runId: "r4" },
      { id: "unlabelled", runId: undefined },
    ];
    const statuses = { r1: "failed", r2: "running", r3: "requested" };
    expect(leftoverSandboxes(sandboxes, statuses)).toEqual(["done"]);
  });
});

describe("mayStartRuns", () => {
  it("starts runs only when FACTORY_POLL is on and the factory is running", () => {
    expect(mayStartRuns("on", "running")).toBe(true);
  });

  it("starts nothing on a machine without FACTORY_POLL=on, such as a laptop", () => {
    expect(mayStartRuns(undefined, "running")).toBe(false);
    expect(mayStartRuns("off", "running")).toBe(false);
    expect(mayStartRuns("ON", "running")).toBe(false);
  });

  it("starts nothing once the factory is stopped", () => {
    expect(mayStartRuns("on", "stopped")).toBe(false);
  });
});

describe("factoryMode", () => {
  it("is running while the factory takes new runs, however many are in flight", () => {
    expect(factoryMode("running", 0)).toBe("running");
    expect(factoryMode("running", 3)).toBe("running");
  });

  it("is draining once stopped while runs are still in flight", () => {
    expect(factoryMode("stopped", 2)).toBe("draining");
  });

  it("is stopped once the last run has finished", () => {
    expect(factoryMode("stopped", 0)).toBe("stopped");
  });
});

describe("runFoldersToPrune", () => {
  const now = new Date("2026-11-20T12:00:00.000Z");
  const daysAgo = (d: number) => now.getTime() - d * 86_400_000;
  const GB = 1024 ** 3;
  const roomy = { total: 40 * GB, free: 30 * GB };

  it("deletes folders of runs older than 30 days and keeps the rest", () => {
    const folders = [
      { id: "old", at: daysAgo(31), bytes: GB },
      { id: "recent", at: daysAgo(29), bytes: GB },
    ];
    expect(runFoldersToPrune(folders, new Set(), roomy, now)).toEqual(["old"]);
  });

  it("never deletes the folder of a run in flight, however old", () => {
    const folders = [{ id: "stuck", at: daysAgo(40), bytes: GB }];
    expect(runFoldersToPrune(folders, new Set(["stuck"]), roomy, now)).toEqual([]);
  });

  it("below 20% free, deletes the oldest folders until 25% is free", () => {
    // 40 GB volume, 6 GB free (15%): 10 GB free (25%) needs 4 GB more.
    const folders = [
      { id: "c", at: daysAgo(3), bytes: 3 * GB },
      { id: "a", at: daysAgo(10), bytes: 2 * GB },
      { id: "b", at: daysAgo(5), bytes: 1 * GB },
      { id: "d", at: daysAgo(1), bytes: 3 * GB },
    ];
    expect(runFoldersToPrune(folders, new Set(), { total: 40 * GB, free: 6 * GB }, now)).toEqual(["a", "b", "c"]);
  });

  it("at 20% free or more, deletes no folder younger than 30 days", () => {
    const folders = [{ id: "a", at: daysAgo(10), bytes: 2 * GB }];
    expect(runFoldersToPrune(folders, new Set(), { total: 40 * GB, free: 8 * GB }, now)).toEqual([]);
  });

  it("counts what the age limit frees toward the 25%", () => {
    const folders = [
      { id: "old", at: daysAgo(31), bytes: 4 * GB },
      { id: "young", at: daysAgo(2), bytes: 1 * GB },
    ];
    expect(runFoldersToPrune(folders, new Set(), { total: 40 * GB, free: 6 * GB }, now)).toEqual(["old"]);
  });

  it("skips runs in flight when freeing space, and stops when nothing else is left", () => {
    const folders = [
      { id: "busy", at: daysAgo(9), bytes: 5 * GB },
      { id: "a", at: daysAgo(4), bytes: 1 * GB },
    ];
    expect(runFoldersToPrune(folders, new Set(["busy"]), { total: 40 * GB, free: 2 * GB }, now)).toEqual(["a"]);
  });
});

describe("blockedBy", () => {
  it("names the blockers still open, and none that are done or cancelled", () => {
    expect(
      blockedBy([
        { identifier: "REC-1", state: "open" },
        { identifier: "REC-2", state: "done" },
        { identifier: "REC-3", state: "cancelled" },
      ]),
    ).toEqual(["REC-1"]);
    expect(blockedBy([])).toEqual([]);
  });
});

describe("nowUnblocked", () => {
  it("keeps only the open tickets whose every blocker is closed", () => {
    const dependents = [
      { id: "a", identifier: "REC-10", state: "open" as const, blockers: [{ identifier: "REC-1", state: "done" as const }] },
      {
        id: "b",
        identifier: "REC-11",
        state: "open" as const,
        blockers: [
          { identifier: "REC-1", state: "done" as const },
          { identifier: "REC-2", state: "open" as const },
        ],
      },
      { id: "c", identifier: "REC-12", state: "cancelled" as const, blockers: [{ identifier: "REC-1", state: "done" as const }] },
    ];
    expect(nowUnblocked(dependents)).toEqual([{ id: "a", identifier: "REC-10" }]);
  });
});
