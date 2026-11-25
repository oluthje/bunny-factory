import { describe, expect, it } from "vitest";
import { branchOf } from "./scope.ts";

describe("branchOf", () => {
  it("reads the branch from the **Branch:** line", () => {
    expect(branchOf("**Branch:** release/2026-11-25\n**Area:** Portal checkout")).toBe("release/2026-11-25");
  });

  it("takes the branch in backticks too", () => {
    expect(branchOf("Focus: billing.\n\n**Branch:** `production`")).toBe("production");
  });

  it("is null without the line, so the run takes main", () => {
    expect(branchOf("Billing, portal checkout and the subscriptions API.")).toBeNull();
  });

  it("ignores the word inside a sentence", () => {
    expect(branchOf("The **Branch:** line is optional.")).toBeNull();
  });
});
