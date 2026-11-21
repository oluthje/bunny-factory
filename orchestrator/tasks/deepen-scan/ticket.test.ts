import { describe, expect, it } from "vitest";
import { scanTicket, stamp, undecided } from "./ticket.ts";

const LA = "America/Los_Angeles";

describe("scanTicket", () => {
  it("dates the ticket to the minute in the time zone, since nothing else names a scan", () => {
    // 15:00 UTC on a Monday in November is 07:00 in California.
    const t = scanTicket(new Date("2026-11-23T15:00:00Z"), LA, "");
    expect(t.title).toBe("Deepen scan: 2026-11-23 07:00");
    expect(t.description).toContain("No direction given");
  });

  it("follows daylight saving time", () => {
    expect(stamp(new Date("2026-07-06T14:00:00Z"), LA)).toBe("2026-07-06 07:00");
  });

  it("carries the direction in the title and the description", () => {
    const t = scanTicket(new Date("2026-11-23T15:00:00Z"), LA, "  billing in\napi ");
    expect(t.title).toBe("Deepen scan: 2026-11-23 07:00 · billing in api");
    expect(t.description).toBe("Direction: billing in api");
  });

  it("shortens a long direction in the title only", () => {
    const long = "x".repeat(200);
    const t = scanTicket(new Date("2026-11-23T15:00:00Z"), LA, long);
    expect(t.title.length).toBeLessThan(100);
    expect(t.description).toContain(long);
  });
});

describe("undecided", () => {
  const c = (state: "open" | "done" | "cancelled", ...labels: string[]) => ({ state, labels: ["oscar-factory:candidate", ...labels] });

  it("counts open candidates queued for the refuter, being refuted, or waiting on Oscar", () => {
    const waiting = [
      c("open", "oscar-factory:deepen-refute"),
      c("open", "oscar-factory:deepen-refute", "oscar-factory:in-progress"),
      c("open", "oscar-factory:human-needed"),
    ];
    expect(undecided(waiting)).toEqual(waiting);
  });

  it("leaves out candidates Oscar handed on, finished or cancelled", () => {
    expect(
      undecided([
        c("open", "oscar-factory:implement"),
        c("open", "oscar-factory:review", "oscar-factory:in-progress"),
        c("open"),
        c("done"),
        c("cancelled", "oscar-factory:human-needed"),
      ]),
    ).toEqual([]);
  });
});
