// The run prompt: sandbox/tasks/<task>/prompt.md filled in for one ticket. File I/O kept apart from tasks.ts.
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.ts";
import type { Ticket } from "./logic.ts";
import { renderTemplate, type TaskName } from "./tasks.ts";

/** What reaches the runner: each task's prompt and files (tasks/<task>/) and the skills runs upload (skills/). */
export const SANDBOX_DIR = path.join(import.meta.dirname, "../sandbox");
export const TASKS_DIR = path.join(SANDBOX_DIR, "tasks");
export const SKILLS_DIR = path.join(SANDBOX_DIR, "skills");

export function buildPrompt(args: {
  task: TaskName;
  ticket: Ticket;
  evidenceDir: string;
  prBodyPath: string;
  reviewPath: string;
}): string {
  const { task, ticket, evidenceDir, prBodyPath, reviewPath } = args;
  return renderTemplate(fs.readFileSync(path.join(TASKS_DIR, task, "prompt.md"), "utf8"), {
    identifier: ticket.identifier,
    title: ticket.title,
    url: ticket.url,
    description: ticket.description.trim() || "(no description)",
    branch: ticket.branchName,
    evidenceDir,
    prBodyPath,
    reviewPath,
    timeLimitMinutes: String(config.claudeTimeoutMinutes),
  });
}
