// The review's machine-readable parts: the verdict in review.md, the findings it left as inline
// comments, the questions it leaves for Oscar, and the review as the factory posts it. Pure: no
// I/O, so it is unit-tested in review.test.ts.
import { z } from "zod/v4";
import { questionsSchema, type Question } from "../../src/questions.ts";
import { markForGithub, type Ticket } from "../../src/logic.ts";
import { parseStructuredOutput, structuredRetryPrompt, toCliJsonSchema } from "../../src/structured.ts";

export const VERDICTS = ["PASS", "CHANGES REQUESTED"] as const;
export type AxisVerdict = (typeof VERDICTS)[number];
export type Verdict = { standards: AxisVerdict; spec: AxisVerdict };

/**
 * The verdict from the review's fixed headings, `## Standards: <verdict>` and `## Spec: <verdict>`.
 * Null unless each heading appears exactly once with a known verdict: a review code can't read
 * is not a review.
 */
export function parseVerdict(review: string): Verdict | null {
  const axis = (name: string): AxisVerdict | null => {
    const found = [...review.matchAll(new RegExp(`^## ${name}:[ \\t]*(.*?)[ \\t]*$`, "gm"))];
    if (found.length !== 1) return null;
    const value = found[0]![1]!;
    return (VERDICTS as readonly string[]).includes(value) ? (value as AxisVerdict) : null;
  };
  const standards = axis("Standards");
  const spec = axis("Spec");
  return standards && spec ? { standards, spec } : null;
}

export function verdictLine(v: Verdict): string {
  return `Standards: **${v.standards}** · Spec: **${v.spec}**`;
}

/**
 * The findings the review left, one per line it comments on, and its **Decision needed:** findings
 * as questions. `repos` are the repos it reviewed.
 */
export function reviewExtractionSchema(repos: readonly [string, ...string[]]) {
  return z
    .strictObject({
      comments: z
        .array(
          z.strictObject({
            repo: z.enum(repos).describe("The repo the file is in."),
            path: z.string().min(1).describe("The file, relative to the repo root."),
            line: z
              .number()
              .int()
              .positive()
              .describe(
                "A line in the file as it is on the reviewed branch, inside a hunk of the diff against the base the review started from. A comment outside the hunks is dropped.",
              ),
            body: z
              .string()
              .min(1)
              .describe("The finding, in Markdown: the standard or spec line it breaks, and what to do instead."),
          }),
        )
        .describe("One entry per finding in the review that points at a file and line. Empty is fine."),
      questions: questionsSchema,
    })
    .describe("The review's inline comments and questions.");
}

export type ReviewExtraction = z.infer<ReturnType<typeof reviewExtractionSchema>>;
export type InlineComment = ReviewExtraction["comments"][number];

/** The JSON Schema handed to `claude --json-schema`. */
export function reviewExtractionJsonSchema(repos: readonly [string, ...string[]]): string {
  return toCliJsonSchema(reviewExtractionSchema(repos));
}

/** The comments and questions from the extraction pass's `claude --output-format json` result, validated again here. */
export function parseReviewExtraction(
  resultJson: string,
  repos: readonly [string, ...string[]],
  stderr = "",
): { ok: true; comments: InlineComment[]; questions: Question[] } | { ok: false; error: string } {
  const parsed = parseStructuredOutput(resultJson, reviewExtractionSchema(repos), { pass: "The extraction pass", noun: "comments" }, stderr);
  return parsed.ok ? { ok: true, ...parsed.value } : parsed;
}

/** The prompt for a retried extraction: the same session, told what was wrong with its last answer. */
export function extractionRetryPrompt(error: string): string {
  return structuredRetryPrompt(error, "Answer again with the findings that point at a line and the questions, in the same structure.");
}

/**
 * The lines GitHub accepts an inline review comment on: every line in a hunk of the diff, on the
 * new side, per file. A review with one comment outside the hunks is rejected whole.
 */
export function diffLines(diff: string): Map<string, Set<number>> {
  const files = new Map<string, Set<number>>();
  let inHeader = false;
  let lines: Set<number> | undefined;
  let next = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      inHeader = true;
      lines = undefined;
      continue;
    }
    if (inHeader) {
      if (line.startsWith("+++ b/")) {
        lines = new Set();
        files.set(line.slice("+++ b/".length), lines);
      }
      if (!line.startsWith("@@")) continue;
      inHeader = false;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      next = Number(hunk[1]);
      continue;
    }
    if (lines && (line.startsWith("+") || line.startsWith(" "))) {
      lines.add(next);
      next++;
    }
  }

  return files;
}

/** One repo's comments, split into those GitHub will take and those outside the diff. */
export function placeComments(
  comments: readonly InlineComment[],
  repo: string,
  hunks: Map<string, Set<number>>,
): { placed: InlineComment[]; dropped: InlineComment[] } {
  const placed: InlineComment[] = [];
  const dropped: InlineComment[] = [];
  for (const c of comments) {
    if (c.repo !== repo) continue;
    (hunks.get(c.path)?.has(c.line) ? placed : dropped).push(c);
  }
  return { placed, dropped };
}

/** The agent's review, framed for a PR comment with the ticket link and run id. */
export function reviewComment(t: Ticket, review: string, runId: string): string {
  return markForGithub([
    `Factory review of [${t.identifier}](${t.url}).`,
    "",
    review.trim(),
    "",
    "---",
    `Posted by Oscar's factory (run \`${runId}\`). Its fixes are pushed as commits; the rest are comments, with no approval or change request.`,
  ].join("\n"));
}
