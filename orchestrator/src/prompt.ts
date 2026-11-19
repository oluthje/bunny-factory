// The run prompt: sandbox/tasks/<task>/prompt.md filled in for one ticket. File I/O kept apart from tasks.ts.
import fs from "node:fs";
import path from "node:path";
import { GITHUB_MARKER, type Ticket } from "./logic.ts";
import { renderTemplate, type TaskName } from "./tasks.ts";

/** What reaches the runner: each task's prompt and files (tasks/<task>/) and the skills runs upload (skills/). */
export const SANDBOX_DIR = path.join(import.meta.dirname, "../sandbox");
export const TASKS_DIR = path.join(SANDBOX_DIR, "tasks");
export const SKILLS_DIR = path.join(SANDBOX_DIR, "skills");
/** Claude Code's user settings for every run, uploaded to ~/.claude/settings.json. */
export const SETTINGS_FILE = path.join(SANDBOX_DIR, "settings.json");

/**
 * `update` is null when the run creates (no branch on GitHub yet), or holds the rendered feedback
 * section when it builds on the ticket's existing branch. Only `implement` uses it.
 * `prBody` is the open PR's body, for `review`: context next to the ticket, which stays the spec.
 */
export function buildPrompt(args: {
  task: TaskName;
  ticket: Ticket;
  evidenceDir: string;
  prBodyPath: string;
  reviewPath: string;
  timeLimitMinutes: number;
  update: { feedback: string } | null;
  prBody: string | null;
}): string {
  const { task, ticket, evidenceDir, prBodyPath, reviewPath, timeLimitMinutes, update, prBody } = args;
  return renderTemplate(fs.readFileSync(path.join(TASKS_DIR, task, "prompt.md"), "utf8"), {
    identifier: ticket.identifier,
    title: ticket.title,
    url: ticket.url,
    description: ticket.description.trim() || "(no description)",
    branch: ticket.branchName,
    evidenceDir,
    prBodyPath,
    reviewPath,
    timeLimitMinutes: String(timeLimitMinutes),
    mode: update ? "update" : "create",
    start: update
      ? "checked out at the PR's current head in every repo that has it, and from an up-to-date `main` in the rest"
      : "checked out from an up-to-date `main` in every repo",
    feedback: update
      ? `## Feedback for this round\n\nThe ticket's branch is already on GitHub with open PRs, so this run **updates** them. The ticket above is still the spec for the whole PR. The feedback below is what Oscar wants changed this round, on top of it.\n\n${update.feedback}`
      : "",
    prContext: prBody?.trim()
      ? `## The PR body\n\nContext, not the spec: the implementer's account of the PR, with its Decisions and Gaps. Check what it claims against the code. A Decision recording that Oscar asked for a change that departs from the ticket is not a spec failure: judge that part against the request.\n\n<pr-body>\n${prBody.replaceAll(GITHUB_MARKER, "").trim()}\n</pr-body>`
      : "",
  });
}
