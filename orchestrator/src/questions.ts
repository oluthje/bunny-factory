// Question cards: the calls a run leaves for Oscar, shaped so he can answer each one at a glance:
// the recommended option open under "Yes", the rest folded under "No".
// A task's structured pass returns them under this schema; the task puts the rendered cards at the
// top of its Linear comment and folds the full write-up under them. Named apart from a write-up's
// `## Decisions`, which are calls the agent already made. Pure: no I/O, so it is
// unit-tested in test/questions.test.ts.
import { z } from "zod/v4";

const optionSchema = z.strictObject({
  label: z.string().min(1).describe("The option's name, at most five words."),
  outcome: z
    .string()
    .min(1)
    .describe("What the user sees, or what changes for them, if Oscar picks this option. One sentence, in product terms, with no file names."),
  cost: z
    .string()
    .min(1)
    .describe("What this option costs, as a phrase of at most ten words: the work it adds, or the harm to users it causes or leaves in place. `None` only when it costs neither."),
  recommended: z.boolean().describe("True for the one option you'd pick."),
  interface: z
    .string()
    .nullable()
    .describe(
      "The interface this option adds or changes, as code of at most five lines: a type, a function signature, an API field, a config or form-definition key. Null when the option changes only implementation.",
    ),
});

export const questionSchema = z
  .strictObject({
    question: z
      .string()
      .min(1)
      .describe("One yes/no question, at most fifteen words, worded so that yes accepts the recommended option."),
    context: z.string().min(1).describe("What forces the choice, in one short paragraph."),
    options: z.array(optionSchema).min(2).max(4).describe("The options, two to four."),
    because: z.string().min(1).describe("Why the recommended option, in one sentence."),
    visual: z
      .string()
      .nullable()
      .describe(
        "Whenever the options differ in what the user sees, in how the UI looks or behaves: the Markdown image, `![alt](<path>)`, of the side-by-side mockup you saved in the evidence directory, one column per option. Null otherwise.",
      ),
  })
  .refine((d) => d.options.filter((o) => o.recommended).length === 1, { message: "Exactly one option is recommended." });

export type Question = z.infer<typeof questionSchema>;
type Option = Question["options"][number];

export const questionsSchema = z
  .array(questionSchema)
  .describe("Every question the write-up leaves for Oscar to answer, most important first. Empty when it leaves none.");

/** A letter per option: A, B, C, D. */
const letter = (i: number) => String.fromCharCode(65 + i);

/** Text on one line. */
const oneLine = (s: string) => s.replace(/\s*\n\s*/g, " ").trim();

/** Every line quoted, blank ones included, so the block holds together. */
const quoted = (s: string) =>
  s
    .split("\n")
    .map((l) => `> ${l}`.trimEnd())
    .join("\n");

/** An option's detail lines, then any interface code. */
function optionBody(o: Option, lines: string[]): string {
  const text = [`**User sees:** ${oneLine(o.outcome)}`, ...lines].join("\n");
  return o.interface?.trim() ? `${text}\n\n\`\`\`\n${o.interface.trim()}\n\`\`\`` : text;
}

/**
 * One question card: the question, any mockup, the recommended option open under "Yes", each other
 * option folded under "No" with its cost in the title only, and the context folded last.
 */
function card(d: Question, n: number): string {
  const pick = d.options.find((o) => o.recommended)!;
  const yesTitle = `➡️ **Yes → ${letter(d.options.indexOf(pick))}. ${oneLine(pick.label)}**`;
  const yes = quoted(`${yesTitle}\n\n${optionBody(pick, [`**Cost:** ${oneLine(pick.cost)}`, `**Why:** ${oneLine(d.because)}`])}`);
  const nos = d.options.flatMap((o, i) =>
    o === pick ? [] : [collapsed(`No → ${letter(i)}. ${oneLine(o.label)} · ${oneLine(o.cost)}`, optionBody(o, []))],
  );
  return [
    `### Q${n} · ${oneLine(d.question)}`,
    ...(d.visual?.trim() ? [d.visual.trim()] : []),
    yes,
    ...nos,
    collapsed("Why this comes up", d.context),
  ].join("\n\n");
}

/** The question cards, numbered Q1, Q2, …. Empty with no questions. */
export function questionCards(questions: readonly Question[]): string {
  return questions.map((d, i) => card(d, i + 1)).join("\n\n");
}

/** A Linear collapsible section: the title shows, the body opens on a click. */
function collapsed(title: string, body: string): string {
  return `+++ ${title}\n\n${body.trim()}\n\n+++`;
}

/**
 * A run's Linear report: its head line, its question cards, then the full write-up under `title`.
 * The write-up is folded when `fold`: the task folds it once nothing in it needs Oscar's eyes.
 */
export function questionReport(r: { head: string; questions: readonly Question[]; title: string; body: string; fold: boolean }): string {
  return [r.head, questionCards(r.questions), r.fold ? collapsed(r.title, r.body) : r.body].filter(Boolean).join("\n\n");
}
