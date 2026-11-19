// The ticket's factory labels are its state, and this is the one place that changes them.
// Pure: it says which labels change; linear.ts applies the change. Unit-tested in test/transitions.test.ts.
//
//   oscar-factory:<task>        queued: the poller starts a run of <task>
//        │ picked up
//        ▼
//   oscar-factory:in-progress   a run is queued or working
//        │ finished
//        ├─ CHAIN names a next task ──▶ oscar-factory:<next>   (queued again)
//        └─ otherwise ───────────────▶ oscar-factory:human-needed
//
// Oscar moves the ticket on from human-needed by adding a task label. Every hand-off between
// tasks goes through the labels, so the poller is the only thing that starts runs.
import { HUMAN_NEEDED_LABEL, IN_PROGRESS_LABEL, taskLabel, type TaskName } from "./tasks.ts";

export type LabelChange = { add: string[]; remove: string[] };

/** How a run ended, as the chain sees it. */
export type RunEnd = {
  task: TaskName;
  status: "succeeded" | "no_changes" | "failed" | "timed_out" | "cancelled";
  /** The run pushed new commits to the ticket's branch. */
  pushed: boolean;
};

/**
 * What each task hands off to when it ends, or null for "wait for Oscar". Only a run that
 * succeeded is chained: a failed, timed-out or cancelled run always stops for a human.
 */
const CHAIN: { [T in TaskName]: (end: RunEnd & { task: T }) => TaskName | null } = {
  // New commits always get a review, whether they opened the PR or updated it.
  implement: (end) => (end.pushed ? "review" : null),
  review: () => null,
};

export function nextTask(end: RunEnd): TaskName | null {
  if (end.status !== "succeeded") return null;
  return (CHAIN[end.task] as (end: RunEnd) => TaskName | null)(end);
}

/** The most runs of one task a ticket gets; past it, Oscar has to step in. */
export const LOOP_CAP = 5;

/** The poller takes the ticket: its task label off, so adding it again asks for another run. */
export function pickedUp(task: TaskName): LabelChange {
  return { add: [IN_PROGRESS_LABEL], remove: [taskLabel(task), HUMAN_NEEDED_LABEL] };
}

/** The poller won't start the task: the loop cap is reached. */
export function refused(task: TaskName): LabelChange {
  return { add: [HUMAN_NEEDED_LABEL], remove: [taskLabel(task)] };
}

/** A run ended: queue the next task in the chain, or wait for Oscar. */
export function finished(end: RunEnd): LabelChange {
  const next = nextTask(end);
  return { add: [next ? taskLabel(next) : HUMAN_NEEDED_LABEL], remove: [IN_PROGRESS_LABEL] };
}
