// The ticket a deepen-scan trigger files, and the clock's throttle. The clock (index.ts) and
// `fac deepen` (scripts/factory.ts) both file this ticket; the poller then starts the run from its
// label. Pure: no I/O, so it is unit-tested in ticket.test.ts.
import { HUMAN_NEEDED_LABEL, taskLabel } from "../../src/labels.ts";

/** `2026-11-23 07:00`, in the time zone. */
export function stamp(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, dateStyle: "short", timeStyle: "short" }).format(now);
}

/**
 * The scan's ticket: dated to the minute, since nothing else tells two scans apart. `direction`
 * is where Oscar wants the scan to look, or empty to let the commit history choose.
 */
export function scanTicket(now: Date, timeZone: string, direction: string): { title: string; description: string } {
  const where = direction.trim().replace(/\s+/g, " ");
  const short = where.length > 60 ? `${where.slice(0, 59)}…` : where;
  return {
    title: `Deepen scan: ${stamp(now, timeZone)}${short ? ` · ${short}` : ""}`,
    description: where ? `Direction: ${where}` : "No direction given: the commit history's hot spots choose where to look.",
  };
}

/** The clock files no scan while this many candidates wait undecided. */
export const UNDECIDED_CAP = 3;

/**
 * The candidates still waiting: open tickets queued for deepen-refute, being refuted, or waiting
 * on Oscar. One he handed on to another task, closed or cancelled is decided.
 */
export function undecided<T extends { state: "open" | "done" | "cancelled"; labels: string[] }>(candidates: readonly T[]): T[] {
  const waiting = [taskLabel("deepen-refute"), HUMAN_NEEDED_LABEL];
  return candidates.filter((c) => c.state === "open" && c.labels.some((l) => waiting.includes(l)));
}
