import { describe, expect, it } from "vitest";
import { defect, flow, passOutput, result } from "./fixtures.ts";
import { parseQaResult, qaResultJsonSchema } from "./result.ts";

const known = new Set(["REC-201 #4", "REC-77"]);
const parse = (r: unknown) => parseQaResult(passOutput(r), known);

describe("parseQaResult", () => {
  it("accepts a result whose flows and defects agree", () => {
    const r = result({ flows: [flow(), flow({ name: "Refund twice", result: "defect", defect: 1 })], defects: [defect()] });
    expect(parse(r)).toEqual({ ok: true, result: r });
  });

  it("wants a defect result to name a defect that exists, and every defect hit by a flow", () => {
    const bad = parse(result({ flows: [flow({ result: "defect", defect: 2 })], defects: [defect()] }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error).toContain("a `defect` result needs `defect`");
      expect(bad.error).toContain("no flow hit it");
    }
  });

  it("wants a blocked flow to say which runner gap stopped it", () => {
    const bad = parse(result({ flows: [flow({ result: "blocked" })] }));
    expect(!bad.ok && bad.error).toContain("needs `blockedBy`");
  });

  it("takes only references the run was given", () => {
    const bad = parse(result({ flows: [flow({ result: "defect", defect: 1 })], defects: [defect({ knownAs: "REC-999 #1" })] }));
    expect(!bad.ok && bad.error).toContain("`REC-999 #1` isn't one of the known defects");
  });

  it("wants a passed flow's known defect to come with its outcome", () => {
    expect(parse(result({ flows: [flow({ knownAs: "REC-77" })] })).ok).toBe(false);
    expect(parse(result({ flows: [flow({ knownAs: "REC-77", knownOutcome: "fixed", knownNote: "api#1230 fixed it" })] })).ok).toBe(true);
  });

  it("gives each known defect one result, so the replies can't contradict each other", () => {
    const twice = parse(result({ flows: [flow({ knownAs: "REC-77", knownOutcome: "fixed" }), flow({ result: "defect", defect: 1 })], defects: [defect({ knownAs: "REC-77" })] }));
    expect(!twice.ok && twice.error).toContain("`REC-77` is checked more than once");
  });

  it("says when the pass wrote nothing", () => {
    expect(parseQaResult("", known, "boom")).toEqual({ ok: false, error: "The coverage pass wrote no result: boom" });
  });

  it("hands Claude Code a schema without the draft URL", () => {
    expect(JSON.parse(qaResultJsonSchema()).$schema).toBeUndefined();
  });
});
