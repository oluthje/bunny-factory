import { describe, expect, it } from "vitest";
import type { CiState } from "../../src/checks.ts";
import type { PrState } from "../../src/github.ts";
import { NO_AUTO_MERGE_LABEL } from "../../src/labels.ts";
import { blockers, bulkBlockers, type PrCheck } from "./gates.ts";

const green: CiState = { state: "green", failing: [], pending: [], checks: 3 };
const state = (over: Partial<PrState> = {}): PrState => ({
  repo: "app",
  draft: false,
  mergeable: true,
  mergeableState: "clean",
  base: "main",
  headSha: "abc",
  open: true,
  merged: false,
  ...over,
});
const pr = (over: Partial<PrState> = {}, rest: Partial<Omit<PrCheck, "state">> = {}): PrCheck => ({
  repo: over.repo ?? "app",
  state: state(over),
  ci: green,
  judgedSha: "abc",
  ...rest,
});
const check = (prs: PrCheck[], over: { labels?: string[] } = {}) => blockers({ prs, labels: over.labels ?? ["Bug"] });

describe("blockers", () => {
  it("clears a ticket whose PRs are open, ready, green, clean and unchanged since judged", () => {
    expect(check([pr(), pr({ repo: "api" })])).toEqual([]);
  });

  it("lets through a PR GitHub calls unstable or with hooks: CI is checked on its own", () => {
    expect(check([pr({ mergeableState: "unstable" }), pr({ repo: "api", mergeableState: "has_hooks" })])).toEqual([]);
  });

  it("holds back a flagged ticket", () => {
    expect(check([pr()], { labels: [NO_AUTO_MERGE_LABEL] })).toEqual(["`oscar-factory:no-auto-merge` is on the ticket."]);
  });

  it("never merges into production", () => {
    expect(check([pr({ base: "production" })])).toEqual(["app: targets `production`, which is merged by hand."]);
  });

  it("holds back a PR with commits the merge run didn't judge", () => {
    expect(check([pr({ headSha: "def" })])).toEqual(["app: has commits pushed after the merge run judged it."]);
  });

  it("holds back a draft, a closed PR, a conflict, and a PR GitHub can't yet place", () => {
    expect(check([pr({ draft: true, mergeableState: "draft" })])).toEqual(["app: is a draft."]);
    expect(check([pr({ open: false })])).toEqual(["app: is no longer open."]);
    expect(check([pr({ mergeable: false, mergeableState: "dirty" })])).toEqual(["app: conflicts with its base."]);
    expect(check([pr({ mergeable: null, mergeableState: "unknown" })])).toEqual(["app: GitHub hasn't worked out whether it can merge."]);
  });

  it("holds back a PR that branch protection blocks or wants brought up to date", () => {
    expect(check([pr({ mergeableState: "blocked" })])).toEqual(["app: branch protection blocks it."]);
    expect(check([pr({ mergeableState: "behind" })])).toEqual(["app: is behind its base, and branch protection wants it up to date."]);
  });

  it("holds back red or unfinished CI, naming the checks", () => {
    expect(check([pr({}, { ci: { state: "red", failing: ["build"], pending: [], checks: 1 } })])).toEqual(["app: CI failed: build."]);
    expect(check([pr({}, { ci: { state: "pending", failing: [], pending: ["rspec"], checks: 1 } })])).toEqual([
      "app: CI is still running: rspec.",
    ]);
  });

  it("lists every reason, ticket first, then each PR", () => {
    expect(check([pr({ draft: true }), pr({ repo: "api", base: "production" })], { labels: [NO_AUTO_MERGE_LABEL] })).toEqual([
      "`oscar-factory:no-auto-merge` is on the ticket.",
      "app: is a draft.",
      "api: targets `production`, which is merged by hand.",
    ]);
  });
});

describe("bulkBlockers", () => {
  const BULK = "factory/bulk/REC-40";
  const bulkPr = (over: Partial<PrState> = {}) => ({ repo: over.repo ?? "app", state: state({ base: BULK, ...over }), judgedSha: "abc" });
  const checkBulk = (prs: ReturnType<typeof bulkPr>[], labels: string[] = ["Bug"], base = BULK) => bulkBlockers({ prs, labels, base });

  it("clears open, ready, clean PRs into the bulk branch, with no CI to wait for", () => {
    expect(checkBulk([bulkPr(), bulkPr({ repo: "api" })])).toEqual([]);
  });

  it("still holds back a flagged ticket", () => {
    expect(checkBulk([bulkPr()], [NO_AUTO_MERGE_LABEL])).toEqual(["`oscar-factory:no-auto-merge` is on the ticket."]);
  });

  it("holds back a PR whose base isn't the ticket's bulk branch", () => {
    expect(checkBulk([bulkPr({ base: "main" })])).toEqual(["app: targets `main`, not the bulk branch `factory/bulk/REC-40`."]);
    expect(checkBulk([bulkPr({ base: "factory/bulk/REC-41" })])).toEqual([
      "app: targets `factory/bulk/REC-41`, not the bulk branch `factory/bulk/REC-40`.",
    ]);
  });

  it("never takes main or production as a bulk branch, whatever the run was given", () => {
    expect(checkBulk([bulkPr({ base: "main" })], ["Bug"], "main")).toEqual(["`main` isn't a bulk branch."]);
    expect(checkBulk([bulkPr({ base: "production" })], ["Bug"], "production")).toEqual(["`production` isn't a bulk branch."]);
  });

  it("still holds back a draft, a conflict, a closed PR and unjudged commits", () => {
    expect(checkBulk([bulkPr({ draft: true })])).toEqual(["app: is a draft."]);
    expect(checkBulk([bulkPr({ mergeable: false, mergeableState: "dirty" })])).toEqual(["app: conflicts with its base."]);
    expect(checkBulk([bulkPr({ open: false })])).toEqual(["app: is no longer open."]);
    expect(checkBulk([bulkPr({ headSha: "def" })])).toEqual(["app: has commits pushed after the merge run judged it."]);
  });
});
