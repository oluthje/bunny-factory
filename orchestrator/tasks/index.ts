// The registry: every task, by name. The only file in tasks/ that src/ imports, and one no task
// imports. Adding a task is a folder in tasks/ and a line here (see docs/coding-standards.md).
import type { Task } from "../src/task.ts";
import { explore } from "./explore/index.ts";
import { implement } from "./implement/index.ts";
import { review } from "./review/index.ts";

export type TaskName = "implement" | "review" | "explore";

export const TASKS: Record<TaskName, Task> = { implement, review, explore };
