// Tasks: what a run does, chosen by the ticket's factory label. `oscar-factory:<task>` starts a run
// of the task with its prompt, and only that task's skills reach the sandbox. How labels move
// between tasks is in transitions.ts.

export const LABEL_PREFIX = "oscar-factory:";

/** Set by the factory while a run works on the ticket. A status, not a task. */
export const IN_PROGRESS_LABEL = `${LABEL_PREFIX}in-progress`;
/** Set by the factory when a run stops, however it ended: the ticket waits on a human. A status, not a task. */
export const HUMAN_NEEDED_LABEL = `${LABEL_PREFIX}human-needed`;
const STATUS_LABELS: readonly string[] = [IN_PROGRESS_LABEL, HUMAN_NEEDED_LABEL];

/**
 * Each task's prompt is sandbox/tasks/<task>/prompt.md: the one entry point, which calls every
 * skill below with the Skill tool, in order. `skills` is what the run uploads to the runner from
 * sandbox/skills/: the skills the prompt calls, and the ones those call in turn.
 * - `implement` creates or updates: it branches from main, or, when the ticket's branch is already on
 *   GitHub, builds on it, acting on Oscar's feedback with the ticket still the spec. It reviews and fixes its own work
 *   with `code-review`, and ends with commits and a PR body; the factory opens or updates draft PRs.
 * - `review` checks out the ticket's branch, fixes the findings it's confident about and commits them,
 *   and ends with a review file; the factory pushes the fixes, posts the review and marks the PRs
 *   ready. It runs specs, so it gets `oscar-factory-stack`, but no browser or evidence.
 */
export const TASKS = {
  implement: {
    skills: [
      "oscar-factory-rules",
      "oscar-factory-stack",
      "oscar-factory-evidence",
      "implement",
      "tdd", // called by implement
      "codebase-design", // called by tdd
      "code-review",
      "pr",
    ],
  },
  review: {
    skills: ["oscar-factory-rules", "oscar-factory-stack", "code-review"],
  },
} as const satisfies Record<string, { skills: readonly string[] }>;

export type TaskName = keyof typeof TASKS;

/** The label that queues a run of the task. */
export function taskLabel(task: TaskName): string {
  return `${LABEL_PREFIX}${task}`;
}

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

/** Fills `{{name}}` placeholders; a placeholder with no value is a bug, so it throws. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    if (v === undefined) throw new Error(`template placeholder {{${key}}} has no value`);
    return v;
  });
}
