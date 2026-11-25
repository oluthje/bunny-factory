// The log excerpt fix-ci's prompt carries.
import { describe, expect, it } from "vitest";
import { logExcerpt } from "./logs.ts";

const line = (text: string) => `2026-11-25T02:22:24.8586545Z ${text}`;

describe("logExcerpt", () => {
  it("ends at the last error, dropping the cleanup steps after it", () => {
    const log = [line("npm ci"), line("FAIL outputCss.unit.test.ts"), line("##[error]Process completed with exit code 1."), line("Post job cleanup.")].join("\n");
    expect(logExcerpt(log)).toBe("npm ci\nFAIL outputCss.unit.test.ts\n##[error]Process completed with exit code 1.");
  });

  it("strips terminal colours", () => {
    expect(logExcerpt(line("\x1b[31m1 failed\x1b[39m"))).toBe("1 failed");
  });

  it("keeps the last lines before the error, and the log's end when it has none", () => {
    const log = ["a", "b", "c", "d"].map(line).join("\n");
    expect(logExcerpt(log, 2)).toBe("c\nd");
  });

  it("cuts a long excerpt to its end", () => {
    expect(logExcerpt("x".repeat(20) + "END", 120, 5)).toBe("…xxEND");
  });
});
