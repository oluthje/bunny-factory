// The merge run's machine-readable verdict: for each open PR on the ticket, merge or human-needed
// and why, plus the order to merge in. The ticket's PRs merge together or not at all. Pure: no
// I/O, so it is unit-tested in verdict.test.ts.
import { z } from "zod/v4";
import { parseStructuredOutput, structuredRetryPrompt, toCliJsonSchema } from "../../src/structured.ts";

export const MERGE_VERDICTS = ["merge", "human-needed"] as const;

/** `repos` are the repos with an open PR on the ticket's branch. */
export function mergeVerdictSchema(repos: readonly [string, ...string[]]) {
  return z
    .strictObject({
      summary: z.string().min(1).describe("One line for the ticket: the verdict for the ticket as a whole, and why."),
      prs: z
        .array(
          z.strictObject({
            repo: z.enum(repos).describe("The repo the PR is in."),
            verdict: z
              .enum(MERGE_VERDICTS)
              .describe("merge: an easy call by the rubric, safe to land with nobody looking. Anything else, or unsure, is human-needed."),
            reason: z.string().min(1).describe("Why, in one or two sentences, citing the rubric."),
          }),
        )
        .describe("One entry per open PR, each repo once."),
      order: z
        .array(z.enum(repos))
        .describe("The order to merge the PRs in, every repo once, when it matters, such as an api field the app reads. Empty for the default: api first."),
    })
    .describe("The merge run's verdict on each of the ticket's open PRs.");
}

export type MergeVerdict = z.infer<ReturnType<typeof mergeVerdictSchema>>;
export type PrVerdict = MergeVerdict["prs"][number];

/** The JSON Schema handed to `claude --json-schema`. */
export function mergeVerdictJsonSchema(repos: readonly [string, ...string[]]): string {
  return toCliJsonSchema(mergeVerdictSchema(repos));
}

/**
 * The verdict from the pass's `claude --output-format json` result, validated again here, and
 * judging each open PR exactly once: a PR with no verdict is as good as no verdict.
 */
export function parseMergeVerdict(
  resultJson: string,
  repos: readonly [string, ...string[]],
  stderr = "",
): { ok: true; value: MergeVerdict } | { ok: false; error: string } {
  const parsed = parseStructuredOutput(resultJson, mergeVerdictSchema(repos), { pass: "The verdict pass", noun: "verdicts" }, stderr);
  if (!parsed.ok) return parsed;
  const problems = repos.flatMap((repo) => {
    const n = parsed.value.prs.filter((p) => p.repo === repo).length;
    return n === 1 ? [] : [n === 0 ? `no verdict for ${repo}` : `${repo} judged ${n} times`];
  });
  if (problems.length) return { ok: false, error: `The verdict pass must judge each open PR once: ${problems.join(", ")}.` };
  return parsed;
}

/** The prompt for a retried pass: the same session, told what was wrong with its last answer. */
export function verdictRetryPrompt(error: string): string {
  return structuredRetryPrompt(error, "Answer again with a verdict for each open PR, in the same structure.");
}

/** The PRs not cleared to merge. Any one holds back the whole ticket. */
export function holdouts(verdict: MergeVerdict): PrVerdict[] {
  return verdict.prs.filter((p) => p.verdict !== "merge");
}
