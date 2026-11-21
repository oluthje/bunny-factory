// src/bulk.ts: bulk branch names, where a run works, and the sweep's next step for a batch.
import { describe, expect, it } from "vitest";
import { batchStep, bulkBranch, bulkParentOf, isBulkBranch, placeRun } from "../src/bulk.ts";
import { BULK_LABEL } from "../src/labels.ts";
import { ticket } from "./fixtures.ts";

describe("bulk branch names", () => {
  it("names the branch after the parent ticket", () => {
    expect(bulkBranch("REC-40")).toBe("factory/bulk/REC-40");
  });

  it("tells a bulk branch from any other, and reads its parent back", () => {
    expect(isBulkBranch("factory/bulk/REC-40")).toBe(true);
    expect(isBulkBranch("main")).toBe(false);
    expect(isBulkBranch("factory/bulk/")).toBe(false);
    expect(bulkParentOf("factory/bulk/REC-40")).toBe("REC-40");
    expect(bulkParentOf("oscar/rec-40-thing")).toBeNull();
  });
});

describe("placeRun", () => {
  const parent = (over: { labels?: string[] } = {}) => ({ identifier: "REC-40", labels: over.labels ?? [BULK_LABEL] });

  it("runs a ticket with no parent on its own branch, from main", () => {
    expect(placeRun({ ticket: ticket(), parent: null, bulkBranchExists: () => false })).toEqual({
      base: "main",
      branch: ticket().branchName,
      bulkParent: false,
    });
  });

  it("runs a sub-ticket of an opted-in parent from the parent's bulk branch", () => {
    expect(placeRun({ ticket: ticket(), parent: parent(), bulkBranchExists: () => false })).toEqual({
      base: "factory/bulk/REC-40",
      branch: ticket().branchName,
      bulkParent: false,
    });
  });

  it("keeps a batch's base once its bulk branch exists, though the parent lost the label", () => {
    const exists = (name: string) => name === "factory/bulk/REC-40";
    expect(placeRun({ ticket: ticket(), parent: parent({ labels: [] }), bulkBranchExists: exists }).base).toBe("factory/bulk/REC-40");
  });

  it("runs a sub-ticket of a parent that never opted in from main", () => {
    expect(placeRun({ ticket: ticket(), parent: parent({ labels: ["Bug"] }), bulkBranchExists: () => false }).base).toBe("main");
  });

  it("runs the parent itself on its bulk branch, into main, once the branch exists", () => {
    const exists = (name: string) => name === "factory/bulk/REC-40";
    expect(placeRun({ ticket: ticket({ identifier: "REC-40", labels: [BULK_LABEL] }), parent: null, bulkBranchExists: exists })).toEqual({
      base: "main",
      branch: "factory/bulk/REC-40",
      bulkParent: true,
    });
  });

  it("runs an opted-in parent as any ticket while it has no bulk branch yet", () => {
    expect(placeRun({ ticket: ticket({ identifier: "REC-40", labels: [BULK_LABEL] }), parent: null, bulkBranchExists: () => false })).toEqual({
      base: "main",
      branch: ticket().branchName,
      bulkParent: false,
    });
  });

  it("still treats a parent whose bulk branch exists as one, without the label", () => {
    const exists = (name: string) => name === "factory/bulk/REC-123";
    expect(placeRun({ ticket: ticket(), parent: null, bulkBranchExists: exists }).bulkParent).toBe(true);
  });

  it("gives a grandchild no bulk base from its grandparent: only the direct parent counts", () => {
    // The direct parent didn't opt in; whatever its own parent did doesn't reach here.
    expect(placeRun({ ticket: ticket(), parent: parent({ labels: [] }), bulkBranchExists: () => false }).base).toBe("main");
  });
});

describe("batchStep", () => {
  const step = (over: Partial<Parameters<typeof batchStep>[0]> = {}) =>
    batchStep({ pr: null, branchSha: "tip", aheadOfMain: 0, subTicketsOpen: 1, ...over });
  const pr = (state: "open" | "merged" | "closed", draft = false, headSha = "tip") => ({ state, draft, headSha });

  it("waits while nothing has merged into the bulk branch yet", () => {
    expect(step()).toBe("wait");
  });

  it("opens the draft PR into main once a sub-ticket has merged", () => {
    expect(step({ aheadOfMain: 2 })).toBe("open-draft");
  });

  it("marks the draft ready once every sub-ticket is closed", () => {
    expect(step({ pr: pr("open", true), aheadOfMain: 3, subTicketsOpen: 0 })).toBe("mark-ready");
  });

  it("leaves a draft alone while sub-tickets are still open", () => {
    expect(step({ pr: pr("open", true), aheadOfMain: 3, subTicketsOpen: 2 })).toBe("wait");
  });

  it("leaves a ready PR to Oscar", () => {
    expect(step({ pr: pr("open"), subTicketsOpen: 0 })).toBe("wait");
  });

  it("closes the batch out when the PR into main merged", () => {
    expect(step({ pr: pr("merged") })).toBe("close-out");
  });

  it("abandons the batch when the PR into main was closed without merging", () => {
    expect(step({ pr: pr("closed", true) })).toBe("abandon");
  });

  it("ignores a finished PR from an earlier batch: the branch was made again since", () => {
    expect(step({ pr: pr("merged", false, "old"), aheadOfMain: 0 })).toBe("wait");
    expect(step({ pr: pr("closed", false, "old"), aheadOfMain: 1 })).toBe("open-draft");
  });

  it("deletes a branch nothing merged into once every sub-ticket is closed", () => {
    expect(step({ aheadOfMain: 0, subTicketsOpen: 0 })).toBe("delete-empty");
  });
});
