// The explore task's machine-readable parts: its verdict, and the findings comment the factory
// posts and reads back. A later explore run reads it (prompt.ts), and so does implement
// (tasks/implement/prompt.ts): this module is explore's contract with it. Pure: no I/O, so it is
// unit-tested in findings.test.ts.
import { z } from "zod/v4";
import type { TicketComment } from "../../src/comments.ts";
import type { TaskName } from "../index.ts";
import { commentText, hasCommentTag, isFactoryComment } from "../../src/logic.ts";
import { parseStructuredOutput, structuredRetryPrompt, toCliJsonSchema } from "../../src/structured.ts";

/** The tag on the findings comment's marker line: how the factory finds it again. */
export const FINDINGS_TAG = "explore findings";

export const EXPLORE_VERDICTS = ["easy-call", "human-needed"] as const;
export type ExploreVerdict = (typeof EXPLORE_VERDICTS)[number];

export const exploreVerdictSchema = z
  .strictObject({
    verdict: z
      .enum(EXPLORE_VERDICTS)
      .describe(
        "easy-call: the ticket's claims hold up, the right change is clear, nobody would disagree with any decision in it, and it's a two-way door. Anything else is human-needed.",
      ),
  })
  .describe("The explore run's verdict, as written in its findings.");

/** The JSON Schema handed to `claude --json-schema`. */
export const exploreVerdictJsonSchema = (): string => toCliJsonSchema(exploreVerdictSchema);

/** The verdict from the pass's `claude --output-format json` result, validated again here. */
export function parseExploreVerdict(
  resultJson: string,
  stderr = "",
): { ok: true; verdict: ExploreVerdict } | { ok: false; error: string } {
  const parsed = parseStructuredOutput(resultJson, exploreVerdictSchema, { pass: "The verdict pass", noun: "verdict" }, stderr);
  return parsed.ok ? { ok: true, verdict: parsed.value.verdict } : parsed;
}

/** What an explore run hands off to: only an easy call goes straight on; anything else, or no readable verdict, waits for Oscar. */
export function handOff(verdict: ExploreVerdict | null): TaskName | null {
  return verdict === "easy-call" ? "implement" : null;
}

export function verdictRetryPrompt(error: string): string {
  return structuredRetryPrompt(error, "Answer again with the verdict your findings give, in the same structure.");
}

/** The latest findings comment, and Oscar's own comments after it: his answers to its questions. */
export function latestFindings(comments: readonly TicketComment[]): { findings: TicketComment; answers: TicketComment[] } | null {
  const at = comments.findLastIndex((c) => hasCommentTag(c.body, FINDINGS_TAG));
  if (at === -1) return null;
  return { findings: comments[at]!, answers: comments.slice(at + 1).filter(isOscars) };
}

/** Oscar's own comment: his, and not one the factory posted as him. */
export const isOscars = (c: TicketComment) => c.isMe && !isFactoryComment(c.body);

/** A findings comment for a prompt: its text, dated, without the factory's marker line. */
export const findingsBlock = (c: TicketComment) => `<findings date="${c.createdAt.slice(0, 10)}">\n${commentText(c.body)}\n</findings>`;
