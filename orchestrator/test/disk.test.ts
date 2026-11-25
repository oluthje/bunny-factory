// deleteRunInputs (src/disk.ts): a run's `in/` goes, what a retro reads stays, and the folder keeps
// its age for sweep-runs' pruning.
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { config } from "../src/config.ts";
import { deleteRunInputs } from "../src/disk.ts";

const run = "test-run-inputs";
const dir = path.join(config.dataDir, "runs", run);

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("deleteRunInputs", () => {
  it("deletes in/ and keeps the rest and the folder's mtime", () => {
    fs.mkdirSync(path.join(dir, "in"), { recursive: true });
    fs.mkdirSync(path.join(dir, "artifacts"), { recursive: true });
    fs.writeFileSync(path.join(dir, "in", "api.bundle"), "x");
    fs.writeFileSync(path.join(dir, "artifacts", "transcript.jsonl"), "{}");
    fs.writeFileSync(path.join(dir, "prompt.md"), "p");
    const old = new Date("2026-11-01T00:00:00Z");
    fs.utimesSync(dir, old, old);

    expect(deleteRunInputs(run)).toBe(true);
    expect(fs.existsSync(path.join(dir, "in"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "artifacts", "transcript.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "prompt.md"))).toBe(true);
    expect(fs.statSync(dir).mtime.getTime()).toBe(old.getTime());
    expect(deleteRunInputs(run)).toBe(false);
  });

  it("refuses a path", () => {
    expect(() => deleteRunInputs("../x")).toThrow();
  });
});
