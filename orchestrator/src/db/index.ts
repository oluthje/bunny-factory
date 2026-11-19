import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
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

/** One run per ticket per task: a ticket implemented once can still be reviewed once. */
export function ticketHasRun(ticketId: string, task: string): boolean {
  return (
    db.select({ id: runs.id }).from(runs).where(and(eq(runs.ticketId, ticketId), eq(runs.task, task))).get() !==
    undefined
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

export function updateRun(id: string, set: Partial<RunRow>): void {
  db.update(runs).set(set).where(eq(runs.id, id)).run();
}
