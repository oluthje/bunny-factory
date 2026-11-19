// Test data shared by the engine's tests (test/) and the tasks' (tasks/<task>/*.test.ts).
import type { TicketComment } from "../src/comments.ts";
import { linearComment, type Ticket } from "../src/logic.ts";
import { buildPrompt } from "../src/prompt.ts";
import type { TaskName } from "../tasks/index.ts";
import { FINDINGS_TAG } from "../tasks/explore/findings.ts";

export const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  id: "uuid-1",
  identifier: "REC-123",
  title: "Show the refund date on invoices",
  description: "Invoices should show when they were refunded.",
  url: "https://linear.app/bunnyinc/issue/REC-123",
  branchName: "oscar/rec-123-show-the-refund-date-on-invoices",
  labels: ["oscar-factory:implement"],
  updatedAt: "2026-11-18T10:00:00.000Z",
  ...over,
});

/** The task's prompt for the sample ticket, with the task's own placeholders from `vars`. */
export const renderPrompt = (task: TaskName, vars: Record<string, string>) =>
  buildPrompt({ task, ticket: ticket(), timeLimitMinutes: 60, vars });

/** Ticket comments: Oscar's own, a findings comment, and another factory comment (the factory posts as Oscar). */
export const oscar = (body: string, createdAt: string): TicketComment => ({ body, createdAt, isMe: true });
export const findingsComment = (text: string, createdAt: string): TicketComment => ({
  body: linearComment(text, "run-1", FINDINGS_TAG),
  createdAt,
  isMe: true,
});
export const factory = (text: string, createdAt: string): TicketComment => ({ body: linearComment(text, "run-1"), createdAt, isMe: true });
