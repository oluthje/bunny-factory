// The ticket's factory labels: `oscar-factory:<task>` queues a run of the task, two status labels
// say where the ticket stands, and flag labels, set only by Oscar, change how a task behaves.
// Pure: no I/O. How labels move is in transitions.ts.
import type { TaskName } from "../tasks/index.ts";

export const LABEL_PREFIX = "oscar-factory:";

/** Set by the factory while a run works on the ticket. A status, not a task. */
export const IN_PROGRESS_LABEL = `${LABEL_PREFIX}in-progress`;
/** Set by the factory when a run stops, however it ended: the ticket waits on a human. A status, not a task. */
export const HUMAN_NEEDED_LABEL = `${LABEL_PREFIX}human-needed`;
export const STATUS_LABELS: readonly string[] = [IN_PROGRESS_LABEL, HUMAN_NEEDED_LABEL];

/** Set by Oscar: the factory never merges the ticket's PRs. A flag, not a task: it queues nothing. */
export const NO_AUTO_MERGE_LABEL = `${LABEL_PREFIX}no-auto-merge`;
export const FLAG_LABELS: readonly string[] = [NO_AUTO_MERGE_LABEL];

/** The label that queues a run of the task. */
export function taskLabel(task: TaskName): string {
  return `${LABEL_PREFIX}${task}`;
}
