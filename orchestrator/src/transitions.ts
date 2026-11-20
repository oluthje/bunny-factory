// The ticket's factory labels are its state, and this is the one place that changes them.
// Pure: it says which labels change; linear.ts applies the change. Unit-tested in test/transitions.test.ts.
//
//   oscar-factory:<task>                               queued: the poller starts a run of <task>
//        │ picked up
//        ▼
//   oscar-factory:<task> + oscar-factory:in-progress   a run of <task> is queued or working
//        │ finished: both labels off, then
//        ├─ succeeded, and the task names a next one ──▶ oscar-factory:<next>   (queued again)
//        ├─ succeeded, and the task says done ─────────▶ no factory label       (nothing waits)
//        ├─ the factory stopped it (`factory stop`) ───▶ oscar-factory:<task>   (requeued: in-progress off only)
//        └─ otherwise ─────────────────────────────────▶ oscar-factory:human-needed
//
// The task label stays on through the run so Linear shows which stage the ticket is in; the poller
// doesn't start a second run meanwhile because it skips tickets with a run in flight.
//
// Each task decides what it hands off to, in its `conclude` (tasks/<task>/index.ts); this file
// only applies the rule every task shares: a run that didn't succeed always stops for a human.
// Oscar moves the ticket on from human-needed by adding a task label. Every hand-off between
// tasks goes through the labels, so the poller is the only thing that starts runs.
import type { TaskName } from "../tasks/index.ts";
import { HUMAN_NEEDED_LABEL, IN_PROGRESS_LABEL, taskLabel } from "./labels.ts";

export type LabelChange = { add: string[]; remove: string[] };

/**
 * What comes after a run: a task to hand off to, `human` to wait on Oscar, or `done` when the
 * ticket's work is finished and nothing waits on anyone.
 */
export type Next = TaskName | "human" | "done";

/** How a run ended, as the labels see it. */
export type RunEnd = {
  status: "succeeded" | "no_changes" | "failed" | "timed_out" | "cancelled";
  /** What the run asks to come next. */
  next: Next;
};

/** A run that ended any way but `succeeded` stops for a human, whatever it asked for. */
export function nextTask(end: RunEnd): Next {
  return end.status === "succeeded" ? end.next : "human";
}

/** The most runs of one task a ticket gets; past it, Oscar has to step in. */
export const LOOP_CAP = 5;

/** The poller takes the ticket: in-progress on, the task label left on to show the stage. */
export function pickedUp(): LabelChange {
  return { add: [IN_PROGRESS_LABEL], remove: [HUMAN_NEEDED_LABEL] };
}

/** The poller won't start the task: the loop cap is reached. */
export function refused(task: TaskName): LabelChange {
  return { add: [HUMAN_NEEDED_LABEL], remove: [taskLabel(task)] };
}

/**
 * The factory stopped the run itself (`factory stop`, or `stop --now`): in-progress off and the
 * task label on, so the ticket is queued again and the run starts over once the factory starts.
 * The task label is added as well as kept, in case anything took it off meanwhile.
 */
export function requeued(task: TaskName): LabelChange {
  return { add: [taskLabel(task)], remove: [IN_PROGRESS_LABEL] };
}

/**
 * A run of `task` ended: its labels off, then queue the next task, wait for Oscar, or, when done,
 * add nothing. A hand-off to the same task keeps its label, so the ticket is queued again.
 */
export function finished(task: TaskName, end: RunEnd): LabelChange {
  const next = nextTask(end);
  const remove = next === task ? [IN_PROGRESS_LABEL] : [IN_PROGRESS_LABEL, taskLabel(task)];
  const add = next === "done" ? [] : next === "human" ? [HUMAN_NEEDED_LABEL] : [taskLabel(next)];
  return { add, remove };
}
