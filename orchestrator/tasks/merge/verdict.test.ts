import { describe, expect, it } from "vitest";
import { holdouts, mergeVerdictJsonSchema, parseMergeVerdict, type MergeVerdict } from "./verdict.ts";

const repos = ["api", "app"] as const;
const result = (output: unknown) => JSON.stringify({ structured_output: output });
const verdict = (over: Partial<MergeVerdict> = {}): MergeVerdict => ({
  summary: "A one-prop fix with a test, as the ticket asks.",
  prs: [
    { repo: "api", verdict: "merge", reason: "Adds the field, with a spec." },
    { repo: "app", verdict: "merge", reason: "Reads the field." },
  ],
  order: ["api", "app"],
  ...over,
});

describe("parseMergeVerdict", () => {
  it("reads a verdict for every PR", () => {
    expect(parseMergeVerdict(result(verdict()), repos)).toEqual({ ok: true, value: verdict() });
  });

  it("fails when a PR has no verdict, so the pass is asked again", () => {
    const r = parseMergeVerdict(result(verdict({ prs: [verdict().prs[0]!] })), repos);
    expect(r).toEqual({ ok: false, error: "The verdict pass must judge each open PR once: no verdict for app." });
  });

  it("fails when a PR is judged twice", () => {
    const api = verdict().prs[0]!;
    const r = parseMergeVerdict(result(verdict({ prs: [api, api, verdict().prs[1]!] })), repos);
    expect(r).toEqual({ ok: false, error: "The verdict pass must judge each open PR once: api judged 2 times." });
  });

  it("fails on a repo with no open PR", () => {
    const r = parseMergeVerdict(result(verdict({ prs: [...verdict().prs, { repo: "kong", verdict: "merge", reason: "x" }] as never })), repos);
    expect(r.ok).toBe(false);
  });

  it("fails on a missing result", () => {
    expect(parseMergeVerdict("", repos)).toEqual({ ok: false, error: "The verdict pass wrote no result." });
  });
});

describe("holdouts", () => {
  it("is empty only when every PR is cleared to merge", () => {
    expect(holdouts(verdict())).toEqual([]);
  });

  it("names every PR not cleared: one holds back the whole ticket", () => {
    const v = verdict({ prs: [verdict().prs[0]!, { repo: "app", verdict: "human-needed", reason: "Changes the layout." }] });
    expect(holdouts(v)).toEqual([{ repo: "app", verdict: "human-needed", reason: "Changes the layout." }]);
  });
});

describe("mergeVerdictJsonSchema", () => {
  it("limits repos to those with an open PR, and has no $schema key", () => {
    const schema = JSON.parse(mergeVerdictJsonSchema(repos));
    expect(schema.$schema).toBeUndefined();
    expect(schema.properties.prs.items.properties.repo.enum).toEqual(["api", "app"]);
  });
});
