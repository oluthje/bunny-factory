import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { and, count, eq, inArray, isNotNull, max, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { config } from "../config.ts";
import { cursors, runs } from "./schema.ts";

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

/** How many runs of the task the ticket has had, for the loop cap. */
export function countRuns(ticketId: string, task: string): number {
  return db.select({ n: count() }).from(runs).where(and(eq(runs.ticketId, ticketId), eq(runs.task, task))).get()?.n ?? 0;
}

/** When the ticket's latest finished run, other than this one, finished; null if none has. */
export function lastFinishedAt(ticketId: string, exceptRunId: string): string | null {
  return (
    db.select({ at: max(runs.finishedAt) }).from(runs)
      .where(and(eq(runs.ticketId, ticketId), ne(runs.id, exceptRunId), isNotNull(runs.finishedAt)))
      .get()?.at ?? null
  );
}

/** A new run in `requested`, before its event is sent. Returns its id. */
export function recordRun(args: { ticketId: string; ticketIdentifier: string; task: string; trigger: string }): string {
  const id = randomUUID();
  db.insert(runs)
    .values({ id, ...args, status: "requested", createdAt: new Date().toISOString() })
    .run();
  return id;
}

/** Marks a run finished unless it already is: a backstop for a run that died before recording its end. */
export function closeIfOpen(id: string, status: "failed" | "cancelled"): void {
  db.update(runs)
    .set({ status, finishedAt: new Date().toISOString() })
    .where(and(eq(runs.id, id), inArray(runs.status, ["requested", "running"])))
    .run();
}

export function updateRun(id: string, set: Partial<RunRow>): void {
  db.update(runs).set(set).where(eq(runs.id, id)).run();
}
