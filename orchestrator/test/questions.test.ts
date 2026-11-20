import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { questionCards, questionReport, questionsSchema, type Question } from "../src/questions.ts";
import { toCliJsonSchema } from "../src/structured.ts";

const option = (label: string, recommended = false, iface: string | null = null) => ({
  label,
  outcome: `With ${label}, the switch stays editable.`,
  cost: "None",
  recommended,
  interface: iface,
});

const sample = (over: Partial<Question> = {}): Question => ({
  question: "Lock Default template only once it's saved?",
  context: "Fixing the bug makes the switch lock itself.",
  options: [option("Keep today's feel", true, "${initial.isDefault}"), option("Let it lock")],
  because: "A misclick stays undoable.",
  visual: null,
  ...over,
});

describe("questionsSchema", () => {
  it("takes questions with exactly one recommended option", () => {
    expect(questionsSchema.safeParse([sample()]).success).toBe(true);
    expect(questionsSchema.safeParse([]).success).toBe(true);
  });

  it("rejects no pick, two picks, or a single option", () => {
    expect(questionsSchema.safeParse([sample({ options: [option("A"), option("B")] })]).success).toBe(false);
    expect(questionsSchema.safeParse([sample({ options: [option("A", true), option("B", true)] })]).success).toBe(false);
    expect(questionsSchema.safeParse([sample({ options: [option("A", true)] })]).success).toBe(false);
  });

  it("gives the CLI a JSON Schema that keeps code to interfaces", () => {
    const json = JSON.parse(toCliJsonSchema(z.strictObject({ questions: questionsSchema })));
    const opt = json.properties.questions.items.properties.options.items;
    expect(opt.properties.interface.description).toMatch(/Null when the option changes only implementation/);
    expect(opt.additionalProperties).toBe(false);
  });
});

describe("questionCards", () => {
  it("is empty with no questions", () => {
    expect(questionCards([])).toBe("");
  });

  it("opens the recommended option under Yes and folds the others and the context", () => {
    expect(questionCards([sample()])).toBe(
      [
        "### Q1 · Lock Default template only once it's saved?",
        [
          "> ➡️ **Yes → A. Keep today's feel**",
          ">",
          "> **User sees:** With Keep today's feel, the switch stays editable.",
          "> **Cost:** None",
          "> **Why:** A misclick stays undoable.",
          ">",
          "> ```",
          "> ${initial.isDefault}",
          "> ```",
        ].join("\n"),
        "+++ No → B. Let it lock · None\n\n**User sees:** With Let it lock, the switch stays editable.\n\n+++",
        "+++ Why this comes up\n\nFixing the bug makes the switch lock itself.\n\n+++",
      ].join("\n\n"),
    );
  });

  it("numbers the questions", () => {
    expect(questionCards([sample(), sample({ question: "Second?" })])).toContain("\n\n### Q2 · Second?\n\n");
  });

  it("answers yes with whichever option is picked, wherever it sits", () => {
    const out = questionCards([sample({ options: [option("Keep"), option("Lock", true)] })]);
    expect(out).toContain("> ➡️ **Yes → B. Lock**");
    expect(out).toContain("+++ No → A. Keep · None");
  });

  it("shows code only for the options that add an interface", () => {
    const out = questionCards([sample({ options: [option("Keep", true), option("Lock", false, "type Lock = 'live'")] })]);
    expect(out).toContain("stays editable.\n\n```\ntype Lock = 'live'\n```\n\n+++");
    expect(out).not.toContain("> ```");
  });

  it("puts the mockup under the question", () => {
    expect(questionCards([sample({ visual: "![A vs B](/evidence/mock.png)" })])).toMatch(/^### Q1 · .*\n\n!\[A vs B\]\(\/evidence\/mock\.png\)\n\n> ➡️/);
  });

  it("keeps an option's fields on one line each", () => {
    const out = questionCards([sample({ options: [{ ...option("A", true), outcome: "one\ntwo" }, option("B")] })]);
    expect(out).toContain("> **User sees:** one two\n");
  });
});

describe("questionReport", () => {
  it("puts the cards between the head line and the folded write-up", () => {
    const out = questionReport({ head: "Explored.", questions: [sample()], title: "Full findings", body: "## Verdict: human-needed\n", fold: true });
    expect(out).toMatch(/^Explored\.\n\n### Q1 · [\s\S]*\n\n\+\+\+ Full findings\n\n## Verdict: human-needed\n\n\+\+\+$/);
  });

  it("leaves the write-up open when it isn't folded, with no cards", () => {
    expect(questionReport({ head: "Explored.", questions: [], title: "Full findings", body: "Body", fold: false })).toBe("Explored.\n\nBody");
  });
});
