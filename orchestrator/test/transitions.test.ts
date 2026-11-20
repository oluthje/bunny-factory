import { describe, expect, it } from "vitest";
import { HUMAN_NEEDED_LABEL, IN_PROGRESS_LABEL } from "../src/labels.ts";
import { finished, nextTask, pickedUp, refused, requeued, type RunEnd } from "../src/transitions.ts";

const end = (over: Partial<RunEnd> = {}): RunEnd => ({ status: "succeeded", next: "review", ...over });

describe("nextTask", () => {
  it("hands off to the task the run asked for when it succeeded", () => {
    expect(nextTask(end())).toBe("review");
  });

  it("waits on Oscar when the run asked for him", () => {
    expect(nextTask(end({ next: "human" }))).toBe("human");
  });

  it("ends the chain with nobody waiting when a run that succeeded asked for done", () => {
    expect(nextTask(end({ next: "done" }))).toBe("done");
  });

  it("never chains or closes a run that didn't succeed, whatever it asked for", () => {
    for (const status of ["failed", "timed_out", "cancelled", "no_changes"] as const) {
      expect(nextTask(end({ status })), status).toBe("human");
      expect(nextTask(end({ status, next: "done" })), status).toBe("human");
    }
  });
});

describe("label changes", () => {
  it("leaves the task label on at pickup, so Linear shows the stage", () => {
    expect(pickedUp()).toEqual({ add: [IN_PROGRESS_LABEL], remove: [HUMAN_NEEDED_LABEL] });
  });

  it("takes the finished task's label off and queues the next task when the chain goes on", () => {
    expect(finished("implement", end())).toEqual({
      add: ["oscar-factory:review"],
      remove: [IN_PROGRESS_LABEL, "oscar-factory:implement"],
    });
  });

  it("keeps the label when the chain hands off to the same task", () => {
    expect(finished("implement", end({ next: "implement" }))).toEqual({
      add: ["oscar-factory:implement"],
      remove: [IN_PROGRESS_LABEL],
    });
  });

  it("waits on Oscar when the chain ends, the task label off", () => {
    const waiting = { add: [HUMAN_NEEDED_LABEL], remove: [IN_PROGRESS_LABEL, "oscar-factory:review"] };
    expect(finished("review", end({ next: "human" }))).toEqual(waiting);
    expect(finished("review", end({ status: "failed" }))).toEqual(waiting);
    expect(finished("review", end({ status: "failed", next: "review" }))).toEqual(waiting);
  });

  it("takes every factory label off and adds none when the chain is done", () => {
    expect(finished("review", end({ next: "done" }))).toEqual({ add: [], remove: [IN_PROGRESS_LABEL, "oscar-factory:review"] });
  });

  it("refuses past the loop cap: the task label off, waiting on Oscar", () => {
    expect(refused("implement")).toEqual({ add: [HUMAN_NEEDED_LABEL], remove: ["oscar-factory:implement"] });
  });
});

describe("requeued", () => {
  it("takes in-progress off and leaves the task queued, so the run starts again when the factory does", () => {
    expect(requeued("implement")).toEqual({ add: ["oscar-factory:implement"], remove: [IN_PROGRESS_LABEL] });
  });
});
