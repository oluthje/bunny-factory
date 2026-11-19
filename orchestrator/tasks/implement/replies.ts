// implement's reply pass: after an update run, the factory resumes the session and asks for one
// reply per review thread it was given. Pure: no I/O, so it is unit-tested in replies.test.ts.
import { z } from "zod/v4";
import { markForGithub } from "../../src/logic.ts";
import { parseStructuredOutput, structuredRetryPrompt, toCliJsonSchema } from "../../src/structured.ts";

export const OUTCOMES = ["done", "declined", "answered"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** `handles` are the threads the run was given (`T1`, `T2`, …). */
export function threadRepliesSchema(handles: readonly [string, ...string[]]) {
  return z
    .strictObject({
      replies: z
        .array(
          z.strictObject({
            thread: z.enum(handles).describe("The thread's handle from the prompt's feedback section."),
            outcome: z
              .enum(OUTCOMES)
              .describe("done: you made the change. declined: you deliberately didn't. answered: it was a question, not a change."),
            reply: z
              .string()
              .min(1)
              .describe("The reply, in Markdown: what you changed and in which commit, why you declined, or the answer."),
          }),
        )
        .describe("One reply per thread you were given."),
    })
    .describe("Replies to the review threads.");
}

export type ThreadReply = z.infer<ReturnType<typeof threadRepliesSchema>>["replies"][number];

export function threadRepliesJsonSchema(handles: readonly [string, ...string[]]): string {
  return toCliJsonSchema(threadRepliesSchema(handles));
}

export function parseThreadReplies(
  resultJson: string,
  handles: readonly [string, ...string[]],
  stderr = "",
): { ok: true; replies: ThreadReply[] } | { ok: false; error: string } {
  const parsed = parseStructuredOutput(resultJson, threadRepliesSchema(handles), { pass: "The reply pass", noun: "replies" }, stderr);
  if (!parsed.ok) return parsed;
  const seen = new Set<string>();
  const dupes = parsed.value.replies.filter((r) => (seen.has(r.thread) ? true : (seen.add(r.thread), false)));
  if (dupes.length) return { ok: false, error: `The reply pass answered ${dupes.map((d) => d.thread).join(", ")} more than once.` };
  return { ok: true, replies: parsed.value.replies };
}

export function replyRetryPrompt(error: string): string {
  return structuredRetryPrompt(error, "Answer again with one reply per thread, in the same structure.");
}

const LABELS: Record<Outcome, string> = { done: "Done", declined: "Declined", answered: "Answer" };

/** The reply as posted on GitHub: its outcome first, and the factory's marker. */
export function replyBody(r: ThreadReply, runId: string): string {
  return markForGithub(`**${LABELS[r.outcome]}.** ${r.reply.trim()}\n\n_Oscar's factory, run \`${runId}\`._`);
}
