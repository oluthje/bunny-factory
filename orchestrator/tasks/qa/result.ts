// The qa run's structured pass: every flow with its result, every defect it reproduced, the known
// defects it checked again, and the suspects it couldn't reproduce. The zod schema is the one place
// the shape lives; the orchestrator renders and posts from it (report.ts), never the agent.
// Pure: no I/O, so it is unit-tested in result.test.ts.
import { z } from "zod/v4";
import { parseStructuredOutput, structuredRetryPrompt, toCliJsonSchema } from "../../src/structured.ts";
import { SEVERITIES } from "./defects.ts";

const evidenceSchema = z
  .array(
    z.strictObject({
      file: z.string().min(1).describe("The file's name in the evidence directory, such as `double-refund.webm` or `create-subscription.txt`."),
      note: z.string().describe("What it shows, when the name doesn't say, such as `fails: expected 1, got 2`. Empty otherwise."),
    }),
  )
  .describe("The evidence files, as saved in the evidence directory.");

const defectSchema = z.strictObject({
  title: z.string().min(1).describe("One sentence: what goes wrong, as the user or API client sees it."),
  severity: z.enum(SEVERITIES).describe("Blocker: data loss, wrong money, a core flow broken, a security hole. High: ship only with a fix or a waiver. Medium: real, with a workaround. Low: cosmetic or rare."),
  area: z.string().min(1).describe("Where it is, as `Area › Part`, such as `Invoices › Refunds`."),
  steps: z.array(z.string().min(1)).min(1).describe("The steps that reproduce it, from a fresh start, one per item."),
  expected: z.string().min(1),
  actual: z.string().min(1),
  evidence: evidenceSchema,
  where: z.array(z.string()).describe("The code it points at, as `repo/path:line`. Empty when you didn't find it."),
  reproduced: z.string().regex(/^\d+\/\d+$/).describe("How many of your tries reproduced it, as `3/3`."),
  agentNotes: z.string().describe("Spec output, console errors, a network log excerpt: what helps whoever fixes it. Empty if none."),
  knownAs: z
    .string()
    .nullable()
    .describe("The reference of the known defect this is, matched by the same steps and the same wrong result (`REC-201 #4`, or a bug ticket's id). Null for a new defect."),
});

const flowSchema = z.strictObject({
  name: z.string().min(1).describe("The flow, in a few words, as the QA scope lists it."),
  result: z.enum(["passed", "defect", "blocked", "not-reached"]),
  defect: z.number().int().min(1).nullable().describe("For `defect`: which defect it hit, by its position in `defects`, from 1. Null otherwise."),
  blockedBy: z.string().nullable().describe("For `blocked`: the runner gap that stopped it, in a few words. Null otherwise."),
  evidence: evidenceSchema,
  knownAs: z
    .string()
    .nullable()
    .describe("For `passed`: the reference of a known defect whose steps this flow walked and that didn't reproduce. Null otherwise."),
  knownOutcome: z
    .enum(["fixed", "not-reproduced"])
    .nullable()
    .describe("With `knownAs`: `fixed` when a release change explains why it no longer happens, `not-reproduced` when nothing does. Null otherwise."),
  knownNote: z.string().describe("With `knownAs`: one sentence on why, naming the release change for `fixed`. Empty otherwise."),
});

export const qaResultSchema = z
  .strictObject({
    flows: z.array(flowSchema).min(1).describe("Every flow, in the order of the coverage table: the QA scope's flows first, then the ones you added."),
    defects: z.array(defectSchema).describe("Every defect you reproduced, known ones included, each once."),
    suspects: z
      .array(z.strictObject({ suspect: z.string().min(1), tried: z.string().min(1).describe("What you tried, and what happened.") }))
      .describe("Suspects you tried and couldn't reproduce."),
  })
  .describe("The qa run's coverage, defects and suspects, as written in its findings.");

export type QaResult = z.infer<typeof qaResultSchema>;
export type Defect = QaResult["defects"][number];
export type Flow = QaResult["flows"][number];

/** The JSON Schema handed to `claude --json-schema`. */
export const qaResultJsonSchema = (): string => toCliJsonSchema(qaResultSchema);

/** What the schema can't say: each result's fields agree with it, and every known reference is one the run was given. */
function problems(r: QaResult, knownRefs: ReadonlySet<string>): string[] {
  const out: string[] = [];
  r.flows.forEach((f, i) => {
    const at = `flows[${i}] (${f.name})`;
    if (f.result === "defect" && (f.defect === null || f.defect > r.defects.length)) out.push(`${at}: a \`defect\` result needs \`defect\`, a position in \`defects\`.`);
    if (f.result !== "defect" && f.defect !== null) out.push(`${at}: only a \`defect\` result names a defect.`);
    if (f.result === "blocked" && !f.blockedBy) out.push(`${at}: a \`blocked\` result needs \`blockedBy\`.`);
    if (f.knownAs !== null && f.result !== "passed") out.push(`${at}: only a passed flow carries \`knownAs\`; a known defect that still reproduces goes in \`defects\` with \`knownAs\`.`);
    if ((f.knownAs === null) !== (f.knownOutcome === null)) out.push(`${at}: \`knownAs\` and \`knownOutcome\` go together.`);
    if (f.knownAs !== null && !knownRefs.has(f.knownAs)) out.push(`${at}: \`${f.knownAs}\` isn't one of the known defects.`);
  });
  // One verdict per known defect: two would post replies that contradict each other.
  const refs = [...r.defects.map((d) => d.knownAs), ...r.flows.map((f) => f.knownAs)].filter((k): k is string => k !== null);
  for (const ref of new Set(refs.filter((k, i) => refs.indexOf(k) !== i))) out.push(`\`${ref}\` is checked more than once: give each known defect one result, in one place.`);
  r.defects.forEach((d, i) => {
    if (d.knownAs !== null && !knownRefs.has(d.knownAs)) out.push(`defects[${i}] (${d.title}): \`${d.knownAs}\` isn't one of the known defects.`);
    if (!r.flows.some((f) => f.defect === i + 1)) out.push(`defects[${i}] (${d.title}): no flow hit it; add the flow that did.`);
  });
  return out;
}

/** The result from the pass's `claude --output-format json` output, validated again here. */
export function parseQaResult(resultJson: string, knownRefs: ReadonlySet<string>, stderr = ""): { ok: true; result: QaResult } | { ok: false; error: string } {
  const parsed = parseStructuredOutput(resultJson, qaResultSchema, { pass: "The coverage pass", noun: "coverage" }, stderr);
  if (!parsed.ok) return parsed;
  const found = problems(parsed.value, knownRefs);
  return found.length ? { ok: false, error: `The coverage doesn't add up:\n${found.map((p) => `- ${p}`).join("\n")}` } : { ok: true, result: parsed.value };
}

export function qaRetryPrompt(error: string): string {
  return structuredRetryPrompt(error, "Answer again with the flows, defects and suspects your findings give, in the same structure.");
}
