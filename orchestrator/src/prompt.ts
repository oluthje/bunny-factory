// The run prompt: tasks/<task>/prompt.md filled in for one ticket. The engine fills what every task
// shares (the ticket, the run's branch and base, the evidence dir, the run dir, the time limit); the
// task's `prepare` supplies the rest.
import fs from "node:fs";
import path from "node:path";
import type { TaskName } from "../tasks/index.ts";
import type { Ticket } from "./logic.ts";
import { EVIDENCE_DIR, RUN_DIR } from "./runner-paths.ts";

/** Each task's folder: its prompt.md, extract.md and docs reach the runner. */
export const TASKS_DIR = path.join(import.meta.dirname, "../tasks");
/** What every run uploads whatever its task: the skills (only the task's own) and Claude Code's settings. */
export const RUNNER_FILES_DIR = path.join(import.meta.dirname, "../runner-files");
export const SKILLS_DIR = path.join(RUNNER_FILES_DIR, "skills");
/** Claude Code's user settings for every run, uploaded to ~/.claude/settings.json. */
export const SETTINGS_FILE = path.join(RUNNER_FILES_DIR, "settings.json");

/** Fills `{{name}}` placeholders; a placeholder with no value is a bug, so it throws. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    if (v === undefined) throw new Error(`template placeholder {{${key}}} has no value`);
    return v;
  });
}

/**
 * A section of a runner skill, from its `## <heading>` to the next `##` heading, without the
 * heading: for a prompt that carries a list the skill keeps, so it lives in one place.
 * Throws when the skill has no such section.
 */
export function skillSection(skill: string, heading: string): string {
  const text = fs.readFileSync(path.join(SKILLS_DIR, skill, "SKILL.md"), "utf8");
  const at = text.search(new RegExp(`^## ${heading}$`, "m"));
  if (at === -1) throw new Error(`${skill}'s SKILL.md has no "## ${heading}" section`);
  const body = text.slice(text.indexOf("\n", at) + 1);
  const next = body.search(/^## /m);
  return (next === -1 ? body : body.slice(0, next)).trim();
}

/** The task's prompt.md, as written: for checks that don't need it filled in. */
export function promptTemplate(task: TaskName): string {
  return fs.readFileSync(path.join(TASKS_DIR, task, "prompt.md"), "utf8");
}

/** `vars` are the task's own placeholders, from its `prepare`; a task can't override the shared ones. */
export function buildPrompt(args: {
  task: TaskName;
  ticket: Ticket;
  branch: string;
  base: string;
  timeLimitMinutes: number;
  vars: Record<string, string>;
}): string {
  const { task, ticket, branch, base, timeLimitMinutes, vars } = args;
  return renderTemplate(promptTemplate(task), {
    ...vars,
    identifier: ticket.identifier,
    title: ticket.title,
    url: ticket.url,
    description: ticket.description.trim() || "(no description)",
    branch,
    base,
    evidenceDir: EVIDENCE_DIR,
    runDir: RUN_DIR,
    timeLimitMinutes: String(timeLimitMinutes),
  });
}
