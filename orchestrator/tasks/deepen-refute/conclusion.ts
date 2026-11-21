// The deepen-refute task's machine-readable parts: its verdict, and the conclusion comment the
// factory posts on a candidate's ticket and reads back. A later deepen-refute run reads it
// (prompt.ts), and so does deepen-scan (tasks/deepen-scan/candidates.ts), to know how each earlier
// candidate fared: this module is deepen-refute's contract with it. Pure: no I/O, so it is
// unit-tested in conclusion.test.ts.
import { z } from "zod/v4";
import type { TicketComment } from "../../src/comments.ts";
import { taskLabel } from "../../src/labels.ts";
import { commentText, hasCommentTag } from "../../src/logic.ts";
import { parseStructuredOutput, structuredRetryPrompt, toCliJsonSchema } from "../../src/structured.ts";

/** The tag on the conclusion comment's marker line: how the factory finds it again. */
export const CONCLUSION_TAG = "deepen-refute conclusion";

export const REFUTE_VERDICTS = ["do-it", "dont", "not-yet"] as const;
export type RefuteVerdict = (typeof REFUTE_VERDICTS)[number];

/** Each verdict as the conclusion's `## Verdict:` heading and the ticket spell it. */
export const VERDICT_WORDS: Record<RefuteVerdict, string> = { "do-it": "do it", dont: "don't", "not-yet": "not yet" };

export const refuteResultSchema = z
  .strictObject({
    verdict: z
      .enum(REFUTE_VERDICTS)
      .describe("From the conclusion's `## Verdict:` heading: do-it for `do it`, dont for `don't`, not-yet for `not yet`."),
    summary: z
      .string()
      .min(1)
      .describe("At most five short lines of Markdown Oscar can decide from without opening anything: the recommendation, the reason that decides it, the strongest point on the other side, and the cost in numbers."),
    condition: z
      .string()
      .describe("For not-yet, the condition that would make it do-it, as something a later scan can check in the code or the ticket tracker. Empty for the other verdicts."),
  })
  .describe("The deepen-refute run's verdict, as written in its conclusion.");

/** The JSON Schema handed to `claude --json-schema`. */
export const refuteResultJsonSchema = (): string => toCliJsonSchema(refuteResultSchema);

export type RefuteResult = z.infer<typeof refuteResultSchema>;

/** The verdict from the pass's `claude --output-format json` result, validated again here. */
export function parseRefuteResult(resultJson: string, stderr = ""): ({ ok: true } & RefuteResult) | { ok: false; error: string } {
  const parsed = parseStructuredOutput(resultJson, refuteResultSchema, { pass: "The verdict pass", noun: "verdict" }, stderr);
  if (!parsed.ok) return parsed;
  if (parsed.value.verdict === "not-yet" && !parsed.value.condition.trim()) {
    return { ok: false, error: "The verdict pass's verdict is invalid: not-yet needs its condition." };
  }
  return { ok: true, ...parsed.value };
}

export function verdictRetryPrompt(error: string): string {
  return structuredRetryPrompt(error, "Answer again with the verdict, summary and condition your conclusion gives, in the same structure.");
}

/** The ticket's latest conclusion comment, or null when it was never refuted. */
export function latestConclusion(comments: readonly TicketComment[]): TicketComment | null {
  return comments.findLast((c) => hasCommentTag(c.body, CONCLUSION_TAG)) ?? null;
}

/**
 * The conclusion in a conclusion comment, from its `## Verdict:` heading to the close of the fold
 * it sits in: no head line, summary or hand-off line. A comment without the heading is returned
 * whole, without its marker line.
 */
export function conclusionText(body: string): string {
  const text = commentText(body);
  const at = text.search(/^## Verdict:/m);
  if (at === -1) return text;
  const conclusion = text.slice(at);
  const close = conclusion.search(/^\+\+\+$/m);
  return (close === -1 ? conclusion : conclusion.slice(0, close)).trim();
}

/** What a conclusion comment recommends: its verdict in words, and the paragraph under the heading, which carries a `not yet`'s condition. */
export function recommendation(body: string): { verdict: string; why: string } | null {
  const m = /^## Verdict:[ \t]*(.+)\n+((?:(?!#).+\n?)*)/m.exec(conclusionText(body));
  if (!m) return null;
  return { verdict: m[1]!.trim(), why: m[2]!.trim().replace(/\s*\n\s*/g, " ") };
}

/**
 * The run's Linear report: the verdict, Oscar's next step, the link to the HTML report when it was
 * uploaded, the summary, then the full conclusion folded.
 */
export function conclusionReport(r: { head: string; reportUrl: string | null; summary: string; identifier: string; conclusion: string }): string {
  return [
    r.head,
    `**Next:** run \`/factory-deepen-grill ${r.identifier}\` in bunny-factory to decide. To push back first, comment here and add \`${taskLabel("deepen-refute")}\` again.`,
    r.reportUrl ? `[📄 The report (HTML): the candidate and the case for and against it](${r.reportUrl})` : null,
    r.summary.trim() || null,
    `+++ Full conclusion\n\n${r.conclusion.trim()}\n\n+++`,
  ]
    .filter((s): s is string => s !== null)
    .join("\n\n");
}
