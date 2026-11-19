// The ticket's factory labels: `oscar-factory:<task>` queues a run of the task, and two status
// labels say where the ticket stands. Pure: no I/O. How labels move is in transitions.ts.
import type { TaskName } from "../tasks/index.ts";

export const LABEL_PREFIX = "oscar-factory:";

/** Set by the factory while a run works on the ticket. A status, not a task. */
export const IN_PROGRESS_LABEL = `${LABEL_PREFIX}in-progress`;
/** Set by the factory when a run stops, however it ended: the ticket waits on a human. A status, not a task. */
export const HUMAN_NEEDED_LABEL = `${LABEL_PREFIX}human-needed`;
export const STATUS_LABELS: readonly string[] = [IN_PROGRESS_LABEL, HUMAN_NEEDED_LABEL];

/** The label that queues a run of the task. */
export function taskLabel(task: TaskName): string {
  return `${LABEL_PREFIX}${task}`;
}
