// The contract between the engine (functions/run-ticket.ts) and each task (tasks/<task>/index.ts):
// what a task declares, what the engine hands it before the run, what it hands back, and how a
// run reports its end. Every task supplies every field here; none is one task's alone.
import type { GetStepTools } from "inngest";
import type { TaskName } from "../tasks/index.ts";
import { runTask, updateRun } from "./db/index.ts";
import type { inngest } from "./inngest.ts";
import { taskLabel } from "./labels.ts";
import { applyLabels, comment } from "./linear.ts";
import { linearComment, type Ticket } from "./logic.ts";
import { finished, nextTask, type RunEnd } from "./transitions.ts";

/**
 * A task: what a run of it gets on the runner, and its part of the run.
 * - `skills`: what the run uploads from runner-files/skills/: the skills the prompt calls, and the
 *   ones those call in turn.
 * - `docs`: files in the task's folder that its prompt points at, uploaded beside the prompt to
 *   `{{runDir}}/<file>`. The agent reads one when its step comes up, so it stays out of the prompt.
 * - `browser`: the Playwright MCP server, for checking and capturing the UI.
 * - `branch`: the ticket's branch. `optional` builds on it where it's on GitHub and branches from
 *   main where it isn't; `required` fails the run when no repo has it on GitHub; `none` never
 *   fetches or checks it out: every repo is at `origin/main`, and nothing is pushed.
 * - `timeLimitMinutes`: how long Claude may run; null takes CLAUDE_TIMEOUT_MINUTES.
 * - `delivers`: what the pickup comment says the run will come back with.
 * - `prepare`: before the runner exists, gathers the task's inputs; returns what the run needs.
 */
export type Task = {
  skills: readonly string[];
  docs: readonly string[];
  browser: boolean;
  branch: "optional" | "required" | "none";
  timeLimitMinutes: number | null;
  delivers: string;
  prepare: (ctx: RunContext) => Promise<Prepared>;
};

export type Step = GetStepTools<typeof inngest>;

/** What a task's `prepare` gets from the engine, before the runner exists. */
export type RunContext = {
  step: Step;
  runId: string;
  ticket: Ticket;
  branch: string;
  /** The run's folder on the orchestrator: bundles, artifacts and the files the run wrote. */
  localDir: string;
  timeLimitMinutes: number;
  /** Each repo that has the ticket's branch on GitHub, with its head there. */
  heads: Record<string, string>;
  /** Each repo's open PR on the branch. */
  openPrs: Record<string, string>;
};

/** A parse result, as a structured pass reports it. */
export type Parsed = { ok: true } | { ok: false; error: string };

/**
 * A structured-output pass: after the run, the factory resumes its session with the task's
 * extract.md under `claude --json-schema`, checks the JSON with `parse` and retries with
 * `retryPrompt`. The orchestrator, not the agent, acts on the result.
 */
export type Pass = {
  schema: string;
  parse: (text: string, stderr: string) => Parsed;
  retryPrompt: (error: string) => string;
  /** The pass runs only when the agent wrote this file: with nothing to read, there is nothing to extract. */
  needs?: string;
};

/** How the run went, for the task's `conclude`. */
export type Outcome = {
  /** Each file the task asked for in `outputs`, by the same key; empty when the agent wrote none. */
  files: Record<string, string>;
  /** The structured pass's output, empty without one. */
  structured: string;
  /** The last error of the structured pass, or null when it passed or didn't run. */
  passError: string | null;
  timedOut: boolean;
  /** The repos the run pushed new commits to, each repo's head after the push, and how many commits. */
  pushed: string[];
  newHeads: Record<string, string>;
  commits: number;
};

export type Concluded = { status: RunEnd["status"]; prUrls: string[] };

/** A task's part of a run: what it adds before the run, and what it does with the run's work. */
export type Prepared = {
  /** The task's own placeholders in its prompt.md; the engine fills the shared ones (see prompt.ts). */
  vars: Record<string, string>;
  /** Files the agent writes, by key → path on the runner, collected after the run for `conclude`. */
  outputs: Record<string, string>;
  pass: Pass | null;
  /** After the push: posts the task's result, then `finish`es the run. */
  conclude: (outcome: Outcome) => Promise<Concluded>;
};

/**
 * The pass's result for `conclude`: when the pass failed, its last attempt's error says more than
 * a re-parse of its output would.
 */
export function passResult<R extends Parsed>(passError: string | null, reparse: () => R): R | { ok: false; error: string } {
  return passError ? { ok: false, error: passError } : reparse();
}

export const prRef = (u: string) => `[${u.replace("https://github.com/", "").replace("/pull/", "#")}](${u})`;
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The end of the run's Linear report: what the ticket's labels now ask for. */
function handoffLine(end: RunEnd): string {
  const next = nextTask(end);
  return next ? `Handing off: \`${taskLabel(next)}\` queued.` : "Waiting on Oscar.";
}

/**
 * Records the run's end, reports on the ticket, then moves its labels on. The record goes first:
 * the poller only picks up a ticket with no run in flight.
 */
export async function finish(args: {
  runId: string;
  ticketId: string;
  end: RunEnd;
  text: string;
  record: Parameters<typeof updateRun>[1];
  /** Tags the comment so the factory can find it again (see linearComment). */
  tag?: string;
}): Promise<void> {
  const { runId, ticketId, end, text, record, tag } = args;
  updateRun(runId, { ...record, status: end.status, finishedAt: new Date().toISOString() });
  await comment(ticketId, linearComment(`${text}\n\n${handoffLine(end)}`, runId, tag));
  await applyLabels(ticketId, finished(runTask(runId) as TaskName, end));
}
