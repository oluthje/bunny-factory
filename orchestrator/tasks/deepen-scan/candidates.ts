// The deepen-scan task's machine-readable parts: the candidates its structured pass returns, which
// of them get a ticket, what each ticket says, the list of earlier candidates its prompt carries,
// and its report on the scan's ticket. Pure: no I/O, so it is unit-tested in candidates.test.ts.
import { z } from "zod/v4";
import { quote } from "../../src/comments.ts";
import { parseStructuredOutput, structuredRetryPrompt, toCliJsonSchema } from "../../src/structured.ts";

export const STRENGTHS = ["Strong", "Worth exploring", "Speculative"] as const;

/** The most candidates one scan files tickets for: a throttle, opened as the refuter earns trust. */
export const CANDIDATE_CAP = 3;

const candidateSchema = z.strictObject({
  title: z.string().min(1).describe("The candidate's `## ` heading in the candidates file, without the `## `."),
  strength: z.enum(STRENGTHS).describe("Its **Strength:** line."),
  summary: z.string().min(1).describe("One sentence: what would be deepened, and what that buys."),
  body: z
    .string()
    .describe("For a Strong candidate, its whole section from the candidates file, copied word for word, without the `## ` heading line. Empty for the others."),
});

export const scanResultSchema = z
  .strictObject({ candidates: z.array(candidateSchema).describe("Every candidate in the candidates file, in its order.") })
  .describe("The deepen-scan run's candidates, as written in its candidates file.");

export type Candidate = z.infer<typeof candidateSchema>;

/** The JSON Schema handed to `claude --json-schema`. */
export const scanResultJsonSchema = (): string => toCliJsonSchema(scanResultSchema);

/** The candidates from the pass's `claude --output-format json` result, validated again here. */
export function parseScanResult(resultJson: string, stderr = ""): { ok: true; candidates: Candidate[] } | { ok: false; error: string } {
  const parsed = parseStructuredOutput(resultJson, scanResultSchema, { pass: "The candidates pass", noun: "candidates" }, stderr);
  if (!parsed.ok) return parsed;
  const bare = parsed.value.candidates.filter((c) => c.strength === "Strong" && !c.body.trim()).map((c) => `"${c.title}"`);
  if (bare.length) return { ok: false, error: `The candidates pass's candidates are invalid: no body for the Strong ${bare.join(", ")}.` };
  return { ok: true, candidates: parsed.value.candidates };
}

export function candidatesRetryPrompt(error: string): string {
  return structuredRetryPrompt(error, "Answer again with every candidate in your candidates file, in the same structure.");
}

/** The candidates that get a ticket: the Strong ones, in the file's order, up to the cap. */
export function toFile(candidates: readonly Candidate[]): Candidate[] {
  return candidates.filter((c) => c.strength === "Strong").slice(0, CANDIDATE_CAP);
}

/** A candidate's ticket: its section as the description, and where it came from. */
export function candidateTicket(c: Candidate, scan: { identifier: string; url: string }): { title: string; description: string } {
  return {
    title: `Deepen: ${c.title}`,
    description: `${c.body.trim()}\n\n---\n\nA candidate from the deepen scan [${scan.identifier}](${scan.url}). A \`deepen-refute\` run argues against it next; the decision is Oscar's.`,
  };
}

/** A candidate proposed before, as a later scan needs to know it. */
export type Earlier = {
  identifier: string;
  title: string;
  state: "open" | "done" | "cancelled";
  /** What its latest deepen-refute conclusion recommends, or null when it has none. */
  recommendation: { verdict: string; why: string } | null;
  /** Oscar's last comment on a ticket he cancelled: why he turned it down. */
  rejection: string | null;
};

/** The earlier candidates for the prompt, oldest first. */
export function renderEarlier(earlier: readonly Earlier[]): string {
  if (earlier.length === 0) return "None: this is the first scan.";
  return earlier
    .map((e) => {
      const fate = e.state === "cancelled" ? "turned down by Oscar" : e.state === "done" ? "done" : "open";
      const lines = [`- **${e.title.replace(/^Deepen: /, "")}** (${e.identifier}, ${fate})`];
      if (e.recommendation) lines.push(`  The refuter said \`${e.recommendation.verdict}\`: ${e.recommendation.why}`);
      if (e.rejection) lines.push(`  Oscar's reason:\n${quote(e.rejection).replace(/^/gm, "  ")}`);
      return lines.join("\n");
    })
    .join("\n");
}

type Filed = { identifier: string; url: string };

/**
 * The run's Linear report on the scan's ticket: what it found, the tickets it filed, the HTML
 * report when it was uploaded, then every candidate folded.
 */
export function scanReport(r: { candidates: readonly Candidate[]; filed: readonly Filed[]; reportUrl: string | null; markdown: string }): string {
  const strong = r.candidates.filter((c) => c.strength === "Strong");
  const count = `${r.candidates.length} candidate${r.candidates.length === 1 ? "" : "s"}`;
  const head =
    strong.length === 0
      ? `Scanned: ${count}, none strong. No ticket filed.`
      : `Scanned: ${count}, ${strong.length} strong. Filed ${r.filed.length}, each queued for \`deepen-refute\`.`;
  const list = r.candidates.map((c) => {
    const at = strong.indexOf(c);
    const ticket = at === -1 ? null : r.filed[at];
    const note = ticket ? ` → [${ticket.identifier}](${ticket.url})` : at === -1 ? "" : ` (over the cap of ${CANDIDATE_CAP}: no ticket)`;
    return `- **${c.strength}** · ${c.title}${note}: ${c.summary}`;
  });
  return [
    head,
    list.join("\n") || null,
    r.reportUrl ? `[📄 The report (HTML): every candidate with its before/after diagram](${r.reportUrl})` : null,
    `+++ All candidates\n\n${r.markdown.trim()}\n\n+++`,
  ]
    .filter((s): s is string => s !== null)
    .join("\n\n");
}
