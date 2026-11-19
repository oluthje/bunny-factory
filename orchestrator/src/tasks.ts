// The engine's view of the tasks in tasks/index.ts: which task a ticket's labels ask for, and which
// skills a run uploads. Pure: no I/O, so it is unit-tested in test/tasks.test.ts.
import { TASKS, type TaskName } from "../tasks/index.ts";
import { LABEL_PREFIX, STATUS_LABELS } from "./labels.ts";

export { TASKS, type TaskName };

/** Every skill a run of this task uploads. */
export function skillsFor(task: TaskName): string[] {
  return [...TASKS[task].skills];
}

export type TaskChoice = { ok: true; task: TaskName } | { ok: false; reason: string | null };

/** The task a ticket's labels ask for. `reason` is null when the ticket has no factory label. */
export function taskFromLabels(labels: string[]): TaskChoice {
  const factory = labels.filter((l) => l.startsWith(LABEL_PREFIX) && !STATUS_LABELS.includes(l));
  if (factory.length === 0) return { ok: false, reason: null };
  if (factory.length > 1) {
    return { ok: false, reason: `The ticket has ${factory.length} factory labels (${factory.map((l) => `\`${l}\``).join(", ")}). Keep one.` };
  }
  const name = factory[0]!.slice(LABEL_PREFIX.length);
  if (!Object.hasOwn(TASKS, name)) {
    const known = Object.keys(TASKS).map((t) => `\`${LABEL_PREFIX}${t}\``).join(", ");
    return { ok: false, reason: `Unknown factory label \`${factory[0]}\`. Known: ${known}.` };
  }
  return { ok: true, task: name as TaskName };
}
