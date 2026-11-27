// fix-ci's gates: how many fix rounds a ticket gets, when a red check is the base's, and when green CI skips review.
import { describe, expect, it } from "vitest";
import { SKIP_REVIEW_LABEL } from "../../src/labels.ts";
import { alsoRedOnBase, FIX_ROUNDS, fixRound, skipReviewFrom } from "./gates.ts";

describe("fixRound", () => {
  it("counts this run as the first round when no fix-ci run came before it", () => {
    expect(fixRound(1)).toEqual({ next: "fix", round: 1 });
  });

  it("gives the last round, then hands to Oscar", () => {
    expect(fixRound(FIX_ROUNDS)).toEqual({ next: "fix", round: FIX_ROUNDS });
    expect(fixRound(FIX_ROUNDS + 1)).toEqual({ next: "human", rounds: FIX_ROUNDS });
  });
});

describe("alsoRedOnBase", () => {
  it("names the failing checks the base fails too", () => {
    expect(alsoRedOnBase(["build", "rspec"], ["build", "deploy"])).toEqual(["build"]);
  });

  it("names none when the base has no checks", () => {
    expect(alsoRedOnBase(["build"], [])).toEqual([]);
  });
});

describe("skipReviewFrom", () => {
  const BULK = "oscar-factory:bulk";

  it("goes to review without the label", () => {
    expect(skipReviewFrom({ bulkParent: false, labels: [], parentLabels: [BULK] })).toBeNull();
  });

  it("skips review for a ticket with the label, with or without a parent", () => {
    expect(skipReviewFrom({ bulkParent: false, labels: [SKIP_REVIEW_LABEL], parentLabels: [] })).toBe("ticket");
    expect(skipReviewFrom({ bulkParent: false, labels: [SKIP_REVIEW_LABEL], parentLabels: [SKIP_REVIEW_LABEL] })).toBe("ticket");
  });

  it("skips review for every sub-ticket of a parent with the label", () => {
    expect(skipReviewFrom({ bulkParent: false, labels: [], parentLabels: [BULK, SKIP_REVIEW_LABEL] })).toBe("parent");
  });

  it("still reviews a bulk parent's own PR into main", () => {
    expect(skipReviewFrom({ bulkParent: true, labels: [BULK, SKIP_REVIEW_LABEL], parentLabels: [] })).toBeNull();
  });
});
