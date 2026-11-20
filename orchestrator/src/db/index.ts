import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { and, count, desc, eq, inArray, isNotNull, max, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { config } from "../config.ts";
import type { FactoryState } from "../logic.ts";
import { cursors, factoryState, runs } from "./schema.ts";

fs.mkdirSync(config.dataDir, { recursive: true });
const sqlite = new Database(path.join(config.dataDir, "factory.db"));
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);
migrate(db, { migrationsFolder: path.join(import.meta.dirname, "../../drizzle") });

export type RunRow = typeof runs.$inferSelect;
export { runs };

export function getCursor(key: string): string | null {
  return db.select().from(cursors).where(eq(cursors.key, key)).get()?.value ?? null;
}

export function setCursor(key: string, value: string): void {
  db.insert(cursors).values({ key, value }).onConflictDoUpdate({ target: cursors.key, set: { value } }).run();
}

/** A run on the ticket is queued or working. A ticket has one run at a time. */
export function ticketRunInFlight(ticketId: string): boolean {
  return (
    db.select({ id: runs.id }).from(runs)
      .where(and(eq(runs.ticketId, ticketId), inArray(runs.status, ["requested", "running"])))
      .get() !== undefined
  );
}

/** How many runs, on any ticket, are queued or working. The poller keeps it at most `config.maxRuns`. */
export function runsInFlight(): number {
  return db.select({ n: count() }).from(runs).where(inArray(runs.status, ["requested", "running"])).get()?.n ?? 0;
}

/**
 * How many runs of the task the ticket has had, for the loop cap. A cancelled run doesn't count: it
 * was stopped before it could finish its try, by `factory stop` or by hand.
 */
export function countRuns(ticketId: string, task: string): number {
  return (
    db.select({ n: count() }).from(runs)
      .where(and(eq(runs.ticketId, ticketId), eq(runs.task, task), ne(runs.status, "cancelled")))
      .get()?.n ?? 0
  );
}

/** When the ticket's latest finished run, other than this one, finished; null if none has. */
export function lastFinishedAt(ticketId: string, exceptRunId: string): string | null {
  return (
    db.select({ at: max(runs.finishedAt) }).from(runs)
      .where(and(eq(runs.ticketId, ticketId), ne(runs.id, exceptRunId), isNotNull(runs.finishedAt)))
      .get()?.at ?? null
  );
}

/** The task a run is of, as recorded when the poller started it. */
export function runTask(id: string): string {
  const row = db.select({ task: runs.task }).from(runs).where(eq(runs.id, id)).get();
  if (!row) throw new Error(`No run ${id}`);
  return row.task;
}

/** A new run in `requested`, before its event is sent. Returns its id. */
export function recordRun(args: { ticketId: string; ticketIdentifier: string; task: string; trigger: string }): string {
  const id = randomUUID();
  db.insert(runs)
    .values({ id, ...args, status: "requested", createdAt: new Date().toISOString() })
    .run();
  return id;
}

/**
 * Marks a run finished unless it already is: a backstop for a run that died before recording its
 * end. Returns whether the run was still open.
 */
export function closeIfOpen(id: string, status: "failed" | "cancelled"): boolean {
  const res = db.update(runs)
    .set({ status, finishedAt: new Date().toISOString() })
    .where(and(eq(runs.id, id), inArray(runs.status, ["requested", "running"])))
    .run();
  return res.changes > 0;
}

/** The run's status now, or null for a run this orchestrator doesn't know. */
export function runStatus(id: string): RunRow["status"] | null {
  return db.select({ status: runs.status }).from(runs).where(eq(runs.id, id)).get()?.status ?? null;
}

/** Records that Inngest just called the run's function; only a run in flight. See `runs.lastSeenAt`. */
export function heartbeat(id: string): void {
  db.update(runs)
    .set({ lastSeenAt: new Date().toISOString() })
    .where(and(eq(runs.id, id), inArray(runs.status, ["requested", "running"])))
    .run();
}

/** Records the step a run in flight just started, for `factory status`. */
export function recordStep(id: string, step: string): void {
  db.update(runs)
    .set({ currentStep: step })
    .where(and(eq(runs.id, id), inArray(runs.status, ["requested", "running"])))
    .run();
}

/** The last `n` finished runs, newest first. */
export function runsFinished(n: number): RunRow[] {
  return db.select().from(runs).where(isNotNull(runs.finishedAt)).orderBy(desc(runs.finishedAt)).limit(n).all();
}

/** Whether the factory takes new runs, and when poll-linear last fetched tickets. No row means running. */
export function getFactoryState(): { state: FactoryState; changedAt: string | null; lastPolledAt: string | null } {
  const row = db.select().from(factoryState).where(eq(factoryState.id, 1)).get();
  return { state: row?.state ?? "running", changedAt: row?.changedAt ?? null, lastPolledAt: row?.lastPolledAt ?? null };
}

export function setFactoryState(state: FactoryState): void {
  const changedAt = new Date().toISOString();
  db.insert(factoryState).values({ id: 1, state, changedAt })
    .onConflictDoUpdate({ target: factoryState.id, set: { state, changedAt } }).run();
}

export function recordPoll(): void {
  const lastPolledAt = new Date().toISOString();
  db.insert(factoryState).values({ id: 1, state: "running", changedAt: lastPolledAt, lastPolledAt })
    .onConflictDoUpdate({ target: factoryState.id, set: { lastPolledAt } }).run();
}

/** Every run queued or working, for sweep-runs to judge. */
export function runsOpen(): RunRow[] {
  return db.select().from(runs).where(inArray(runs.status, ["requested", "running"])).all();
}

/** The runs with these ids that this orchestrator knows, with their status. */
export function runStatuses(ids: string[]): Record<string, RunRow["status"]> {
  if (ids.length === 0) return {};
  const rows = db.select({ id: runs.id, status: runs.status }).from(runs).where(inArray(runs.id, ids)).all();
  return Object.fromEntries(rows.map((r) => [r.id, r.status]));
}

export function updateRun(id: string, set: Partial<RunRow>): void {
  db.update(runs).set(set).where(eq(runs.id, id)).run();
}
