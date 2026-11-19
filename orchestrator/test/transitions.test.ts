import { describe, expect, it } from "vitest";
import { HUMAN_NEEDED_LABEL, IN_PROGRESS_LABEL } from "../src/tasks.ts";
import { finished, nextTask, pickedUp, refused, type RunEnd } from "../src/transitions.ts";

const end = (over: Partial<RunEnd> = {}): RunEnd => ({ task: "implement", status: "succeeded", pushed: true, ...over });

describe("nextTask", () => {
  it("hands an implement run that pushed commits to review", () => {
    expect(nextTask(end())).toBe("review");
  });

  it("waits on Oscar after an implement run that pushed nothing", () => {
    expect(nextTask(end({ pushed: false }))).toBeNull();
  });

  it("never chains a run that didn't succeed, even one that pushed", () => {
    for (const status of ["failed", "timed_out", "cancelled", "no_changes"] as const) {
      expect(nextTask(end({ status })), status).toBeNull();
    }
  });

  it("ends the chain after review", () => {
    expect(nextTask(end({ task: "review" }))).toBeNull();
  });
});

describe("label changes", () => {
  it("takes the task label off on pickup, so adding it again asks for another run", () => {
    expect(pickedUp("implement")).toEqual({
      add: [IN_PROGRESS_LABEL],
      remove: ["oscar-factory:implement", HUMAN_NEEDED_LABEL],
    });
  });

  it("queues the next task by its label when the chain goes on", () => {
    expect(finished(end())).toEqual({ add: ["oscar-factory:review"], remove: [IN_PROGRESS_LABEL] });
  });

  it("waits on Oscar when the chain ends", () => {
    expect(finished(end({ task: "review" }))).toEqual({ add: [HUMAN_NEEDED_LABEL], remove: [IN_PROGRESS_LABEL] });
    expect(finished(end({ status: "failed" }))).toEqual({ add: [HUMAN_NEEDED_LABEL], remove: [IN_PROGRESS_LABEL] });
  });

  it("refuses past the loop cap: the task label off, waiting on Oscar", () => {
    expect(refused("implement")).toEqual({ add: [HUMAN_NEEDED_LABEL], remove: ["oscar-factory:implement"] });
  });
});
