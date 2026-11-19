// What every task's run module (runs/<task>.ts) shares with run-ticket.ts: the context a run hands
// its task, the paths in the sandbox, and how a run reports its end.
import type { GetStepTools } from "inngest";
import { updateRun } from "../db/index.ts";
import type { inngest } from "../inngest.ts";
import { applyLabels, comment } from "../linear.ts";
import { linearComment, type Ticket } from "../logic.ts";
import { ARTIFACTS } from "../sandbox.ts";
import { taskLabel, type TaskName } from "../tasks.ts";
import { finished, nextTask, type RunEnd } from "../transitions.ts";

export const EVIDENCE_DIR = `${ARTIFACTS}/evidence`;
export const PR_BODY = `${ARTIFACTS}/pr-body.md`;
export const REVIEW = `${ARTIFACTS}/review.md`;

export type Step = GetStepTools<typeof inngest>;

/** What a task's run module gets from run-ticket.ts, before the sandbox exists. */
export type RunContext = {
  step: Step;
  runId: string;
  ticket: Ticket;
  task: TaskName;
  branch: string;
  /** The run's folder on the host: bundles, artifacts and the files the run wrote. */
  localDir: string;
  timeLimitMinutes: number;
  /** Each repo that has the ticket's branch on GitHub, with its head there. */
  heads: Record<string, string>;
  /** Each repo's open PR on the branch. */
  openPrs: Record<string, string>;
};

/**
 * A structured-output pass: after the run, the factory resumes its session with the task's
 * extract.md under `claude --json-schema`, checks the JSON with `validate` and retries with
 * `retryPrompt`. The orchestrator, not the agent, acts on the result.
 */
export type Pass = {
  schema: string;
  /** An error, or null when the output is good. */
  validate: (text: string, stderr: string) => string | null;
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
  /** Task-specific prompt inputs (see prompt.ts). */
  prompt: { update: { feedback: string } | null; prBody: string | null };
  /** Files the agent writes, by key, collected after the run for `conclude`. */
  outputs: Record<string, string>;
  pass: Pass | null;
  /** After the push: posts the task's result, then `finish`es the run. */
  conclude: (outcome: Outcome) => Promise<Concluded>;
};

export type TaskRun = (ctx: RunContext) => Promise<Prepared>;

export const prRef = (u: string) => `[${u.replace("https://github.com/", "").replace("/pull/", "#")}](${u})`;
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The end of the run's Linear report: what the ticket's labels now ask for. */
function handoffLine(end: RunEnd): string {
  const next = nextTask(end);
  return next ? `Handing off: \`${taskLabel(next)}\` queued.` : "Waiting on Oscar.";
}

/** Records the run's end, then moves the ticket's labels on. The record goes first: the poller only picks up a ticket with no run in flight. */
export async function finish(runId: string, ticketId: string, end: RunEnd, text: string, record: Parameters<typeof updateRun>[1]) {
  updateRun(runId, { ...record, status: end.status, finishedAt: new Date().toISOString() });
  await comment(ticketId, linearComment(`${text}\n\n${handoffLine(end)}`, runId));
  await applyLabels(ticketId, finished(end));
}
