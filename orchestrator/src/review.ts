// The review's machine-readable parts: the verdict in review.md, and the findings it left as
// inline comments. Pure: no I/O, so it is unit-tested in test/review.test.ts.
import { z } from "zod/v4";
import { parseStructuredOutput, structuredRetryPrompt, toCliJsonSchema } from "./structured.ts";

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

/** The findings the review left, one per line it comments on. `repos` are the repos it reviewed. */
export function reviewCommentsSchema(repos: readonly [string, ...string[]]) {
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
                "A line in the file as it is on the reviewed branch, inside a hunk of the diff against origin/main. A comment outside the hunks is dropped.",
              ),
            body: z
              .string()
              .min(1)
              .describe("The finding, in Markdown: the standard or spec line it breaks, and what to do instead."),
          }),
        )
        .describe("One entry per finding in the review that points at a file and line. Empty is fine."),
    })
    .describe("The review's inline comments.");
}

export type ReviewComments = z.infer<ReturnType<typeof reviewCommentsSchema>>;
export type InlineComment = ReviewComments["comments"][number];

/** The JSON Schema handed to `claude --json-schema`. */
export function reviewCommentsJsonSchema(repos: readonly [string, ...string[]]): string {
  return toCliJsonSchema(reviewCommentsSchema(repos));
}

/** The comments from the extraction pass's `claude --output-format json` result, validated again here. */
export function parseReviewComments(
  resultJson: string,
  repos: readonly [string, ...string[]],
  stderr = "",
): { ok: true; comments: InlineComment[] } | { ok: false; error: string } {
  const parsed = parseStructuredOutput(resultJson, reviewCommentsSchema(repos), { pass: "The extraction pass", noun: "comments" }, stderr);
  return parsed.ok ? { ok: true, comments: parsed.value.comments } : parsed;
}

/** The prompt for a retried extraction: the same session, told what was wrong with its last answer. */
export function extractionRetryPrompt(error: string): string {
  return structuredRetryPrompt(error, "Answer again with the findings that point at a line, in the same structure.");
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
