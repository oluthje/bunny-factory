// fix-ci's gates: how many fix rounds a ticket gets, and when a red check is the base's.
import { describe, expect, it } from "vitest";
import { alsoRedOnBase, FIX_ROUNDS, fixRound } from "./gates.ts";

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
