import { describe, expect, it } from "vitest";
import {
  diffLines,
  extractionRetryPrompt,
  parseReviewExtraction,
  parseVerdict,
  placeComments,
  reviewExtractionJsonSchema,
  reviewComment,
  verdictLine,
} from "./review.ts";
import { ticket } from "../../test/fixtures.ts";

const review = (standards: string, spec: string) =>
  `## Standards: ${standards}\n\nFine.\n\n## Spec: ${spec}\n\nFine.\n\n## Rules this review wanted and could not find\n\nNone.\n`;

describe("parseVerdict", () => {
  it("reads both axes", () => {
    expect(parseVerdict(review("PASS", "CHANGES REQUESTED"))).toEqual({ standards: "PASS", spec: "CHANGES REQUESTED" });
  });

  it("tolerates trailing whitespace", () => {
    expect(parseVerdict("## Standards: PASS  \n## Spec:\tPASS\n")).toEqual({ standards: "PASS", spec: "PASS" });
  });

  it("is null when an axis is missing, unknown or repeated", () => {
    expect(parseVerdict("## Standards: PASS\n")).toBeNull();
    expect(parseVerdict(review("PASS", "MOSTLY"))).toBeNull();
    expect(parseVerdict(review("PASS | CHANGES REQUESTED", "PASS"))).toBeNull();
    expect(parseVerdict(`${review("PASS", "PASS")}\n## Standards: CHANGES REQUESTED\n`)).toBeNull();
  });

  it("ignores headings that only look alike", () => {
    expect(parseVerdict("### Standards: PASS\n## Spec: PASS\n")).toBeNull();
  });

  it("formats a one-line summary", () => {
    expect(verdictLine({ standards: "PASS", spec: "CHANGES REQUESTED" })).toBe(
      "Standards: **PASS** · Spec: **CHANGES REQUESTED**",
    );
  });
});

const DIFF = `diff --git a/app/models/invoice.rb b/app/models/invoice.rb
index 1111111..2222222 100644
--- a/app/models/invoice.rb
+++ b/app/models/invoice.rb
@@ -10,4 +10,5 @@ class Invoice
   def total
-    amount
+    amount - refunds
+    # refunded
   end
@@ -40,2 +41,2 @@ class Invoice
-  old
+  new
   end
diff --git a/README.md b/README.md
deleted file mode 100644
index 3333333..0000000
--- a/README.md
+++ /dev/null
@@ -1,2 +0,0 @@
-# Readme
-text
diff --git a/lib/new.rb b/lib/new.rb
new file mode 100644
index 0000000..4444444
--- /dev/null
+++ b/lib/new.rb
@@ -0,0 +1,2 @@
+module New
+end
\\ No newline at end of file
`;

describe("diffLines", () => {
  const hunks = diffLines(DIFF);

  it("takes added and context lines on the new side, skipping removed ones", () => {
    expect([...hunks.get("app/models/invoice.rb")!]).toEqual([10, 11, 12, 13, 41, 42]);
  });

  it("covers new files and skips deleted ones", () => {
    expect([...hunks.get("lib/new.rb")!]).toEqual([1, 2]);
    expect(hunks.has("README.md")).toBe(false);
  });

  it("is empty for an empty diff", () => {
    expect(diffLines("").size).toBe(0);
  });
});

describe("placeComments", () => {
  const hunks = diffLines(DIFF);
  const c = (repo: string, path: string, line: number) => ({ repo, path, line, body: "x" });

  it("keeps this repo's comments on diff lines and drops the rest", () => {
    const { placed, dropped } = placeComments(
      [c("api", "app/models/invoice.rb", 11), c("api", "app/models/invoice.rb", 30), c("api", "nope.rb", 1), c("app", "lib/new.rb", 1)],
      "api",
      hunks,
    );
    expect(placed).toEqual([c("api", "app/models/invoice.rb", 11)]);
    expect(dropped).toEqual([c("api", "app/models/invoice.rb", 30), c("api", "nope.rb", 1)]);
  });
});

describe("review extraction schema", () => {
  const repos = ["api", "app"] as [string, ...string[]];
  const result = (structured_output: unknown) => JSON.stringify({ type: "result", structured_output });

  it("is a JSON Schema that names the reviewed repos and keeps the field descriptions", () => {
    const schema = JSON.parse(reviewExtractionJsonSchema(repos));
    const item = schema.properties.comments.items;
    expect(item.properties.repo.enum).toEqual(["api", "app"]);
    expect(item.properties.line.description).toMatch(/inside a hunk/);
    expect(item.additionalProperties).toBe(false);
  });

  it("has no $schema key, which makes Claude Code reject the whole schema", () => {
    expect(JSON.parse(reviewExtractionJsonSchema(repos))).not.toHaveProperty("$schema");
  });

  it("accepts the CLI's structured output", () => {
    const comments = [{ repo: "api", path: "a.rb", line: 3, body: "Rename this." }];
    expect(parseReviewExtraction(result({ comments, questions: [] }), repos)).toEqual({ ok: true, comments, questions: [] });
    expect(parseReviewExtraction(result({ comments: [], questions: [] }), repos)).toEqual({ ok: true, comments: [], questions: [] });
  });

  it("rejects a missing, garbled or off-schema result", () => {
    expect(parseReviewExtraction("", repos)).toMatchObject({ ok: false, error: /no result/ });
    expect(parseReviewExtraction("", repos, "Error: bad flag\n")).toEqual({
      ok: false,
      error: "The extraction pass wrote no result: Error: bad flag",
    });
    expect(parseReviewExtraction("{not json", repos)).toMatchObject({ ok: false, error: /not JSON/ });
    expect(parseReviewExtraction(JSON.stringify({ type: "result", subtype: "error_max_turns" }), repos)).toEqual({
      ok: false,
      error: "The extraction pass returned no structured output (error_max_turns).",
    });
    expect(parseReviewExtraction(result({ comments: [{ repo: "kong", path: "a", line: 1, body: "x" }], questions: [] }), repos)).toMatchObject({
      ok: false,
      error: /repo/,
    });
    expect(parseReviewExtraction(result({ comments: [{ repo: "api", path: "a", line: 0, body: "x" }], questions: [] }), repos)).toMatchObject({
      ok: false,
    });
    expect(parseReviewExtraction(result({ comments: [] }), repos)).toMatchObject({ ok: false, error: /questions/ });
  });
});

describe("extractionRetryPrompt", () => {
  it("feeds back the error and asks again from the session, with no tools", () => {
    const prompt = extractionRetryPrompt("The extraction pass's comments are invalid: ✖ Invalid option");
    expect(prompt).toContain("✖ Invalid option");
    expect(prompt).toContain("same structure");
    expect(prompt).toContain("no tool calls");
  });
});

describe("reviewComment", () => {
  it("frames the review with the ticket and run, and says it is comment only", () => {
    const body = reviewComment(ticket(), "## Standards\n\nFine.\n", "run-1");
    expect(body).toContain("[REC-123](https://linear.app/bunnyinc/issue/REC-123)");
    expect(body).toContain("## Standards\n\nFine.");
    expect(body).toContain("run `run-1`");
    expect(body).toContain("no approval or change request");
  });
});
