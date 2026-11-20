import { describe, expect, it } from "vitest";
import { mergeOrder } from "./order.ts";

describe("mergeOrder", () => {
  it("takes the agent's order when it names every repo once", () => {
    expect(mergeOrder(["app", "api"], ["api", "app"])).toEqual(["app", "api"]);
  });

  it("falls back to api first, then app, portal and kong, when the agent gives none", () => {
    expect(mergeOrder([], ["kong", "app", "portal", "api"])).toEqual(["api", "app", "portal", "kong"]);
  });

  it("falls back when the agent's order misses or repeats a repo", () => {
    expect(mergeOrder(["app"], ["api", "app"])).toEqual(["api", "app"]);
    expect(mergeOrder(["app", "app"], ["api", "app"])).toEqual(["api", "app"]);
  });

  it("puts a repo the default doesn't know last, by name", () => {
    expect(mergeOrder([], ["docs", "app", "components"])).toEqual(["app", "components", "docs"]);
  });
});
