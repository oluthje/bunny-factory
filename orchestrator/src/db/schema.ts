import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** One row per run, kept forever. Artifacts live in `<dataDir>/runs/<id>/`. */
export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  ticketId: text("ticket_id").notNull(),
  ticketIdentifier: text("ticket_identifier").notNull(),
  trigger: text("trigger").notNull(),
  /** The task from the ticket's `oscar-factory:<task>` label. */
  task: text("task").notNull().default("implement"),
  status: text("status", {
    enum: ["requested", "running", "succeeded", "no_changes", "failed", "timed_out", "cancelled"],
  }).notNull(),
  snapshot: text("snapshot"),
  sandboxId: text("sandbox_id"),
  branch: text("branch"),
  catchUpSeconds: integer("catch_up_seconds"),
  claudeExitCode: integer("claude_exit_code"),
  prUrls: text("pr_urls", { mode: "json" }).$type<string[]>(),
  /** A review run's verdict, read from its fixed headings. Null for other tasks, or a review with none. */
  reviewVerdict: text("review_verdict", { mode: "json" }).$type<Record<string, string>>(),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  finishedAt: text("finished_at"),
});

/** Poll cursors, e.g. `linear.updatedAt`. */
export const cursors = sqliteTable("cursors", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
