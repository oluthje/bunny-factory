import { describe, expect, it } from "vitest";
import { evidenceRefs, linkEvidence } from "../src/logic.ts";

const body = `## Evidence

| Before | After |
| --- | --- |
| ![Before: Kind column](evidence/before-kind-column.png) | ![After: Kind column](evidence/after-kind-column.png) |

![Before: submit flow](/home/daytona/artifacts/evidence/before-submit.gif)
`;

describe("evidenceRefs", () => {
  it("lists each referenced evidence file once, relative or absolute", () => {
    expect(evidenceRefs(body)).toEqual([
      { alt: "Before: Kind column", file: "before-kind-column.png" },
      { alt: "After: Kind column", file: "after-kind-column.png" },
      { alt: "Before: submit flow", file: "before-submit.gif" },
    ]);
  });

  it("ignores images that aren't evidence", () => {
    expect(evidenceRefs("![logo](https://example.com/logo.png)")).toEqual([]);
  });
});

describe("linkEvidence", () => {
  it("turns evidence images into links to their uploaded URLs", () => {
    const out = linkEvidence(body, {
      "before-kind-column.png": "https://uploads.linear.app/a",
      "after-kind-column.png": "https://uploads.linear.app/b",
      "before-submit.gif": "https://uploads.linear.app/c",
    });
    expect(out).toContain("| [🖼 Before: Kind column](https://uploads.linear.app/a) | [🖼 After: Kind column](https://uploads.linear.app/b) |");
    expect(out).toContain("[▶ Before: submit flow](https://uploads.linear.app/c)");
    expect(out).not.toContain("evidence/");
  });

  it("links a recording by its .webm name as a video", () => {
    expect(linkEvidence("![After: flow](evidence/after-flow.webm)", { "after-flow.webm": "https://uploads.linear.app/d" })).toBe(
      "[▶ After: flow](https://uploads.linear.app/d)",
    );
  });

  it("marks a file that was never uploaded instead of leaving a broken image", () => {
    expect(linkEvidence("![After: x](evidence/after-x.png)", {})).toBe("After: x _(not captured)_");
  });
});
