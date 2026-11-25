import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CANDIDATE_LABEL, HUMAN_NEEDED_LABEL, IN_PROGRESS_LABEL, NO_AUTO_MERGE_LABEL } from "../src/labels.ts";
import { promptTemplate, renderTemplate, SETTINGS_FILE, SKILLS_DIR, TASKS_DIR } from "../src/prompt.ts";
import { skillsFor, taskFromLabels, TASKS, type TaskName } from "../src/tasks.ts";
import { ticket } from "./fixtures.ts";

describe("taskFromLabels", () => {
  it("maps the implement label to the implement task", () => {
    expect(taskFromLabels(["Bug", "oscar-factory:implement"])).toEqual({ ok: true, task: "implement" });
  });

  it("maps the review label to the review task", () => {
    expect(taskFromLabels(["oscar-factory:review"])).toEqual({ ok: true, task: "review" });
  });

  it("rejects a factory label with no known task", () => {
    expect(taskFromLabels(["oscar-factory:deploy"])).toEqual({
      ok: false,
      reason: "Unknown factory label `oscar-factory:deploy`. Known: `oscar-factory:implement`, `oscar-factory:review`, `oscar-factory:explore`, `oscar-factory:merge`, `oscar-factory:deepen-scan`, `oscar-factory:deepen-refute`, `oscar-factory:resolve`, `oscar-factory:fix-ci`, `oscar-factory:qa`.",
    });
  });

  it("rejects more than one factory label", () => {
    const r = taskFromLabels(["oscar-factory:implement", "oscar-factory:review"]);
    expect(r.ok).toBe(false);
  });

  it("ignores the factory's own in-progress label", () => {
    expect(taskFromLabels(["oscar-factory:implement", IN_PROGRESS_LABEL])).toEqual({ ok: true, task: "implement" });
    expect(taskFromLabels([IN_PROGRESS_LABEL])).toEqual({ ok: false, reason: null });
  });

  it("ignores the factory's own human-needed label", () => {
    expect(taskFromLabels(["oscar-factory:review", HUMAN_NEEDED_LABEL])).toEqual({ ok: true, task: "review" });
    expect(taskFromLabels([HUMAN_NEEDED_LABEL])).toEqual({ ok: false, reason: null });
  });

  it("ignores flag labels, which change how a task behaves but queue none", () => {
    expect(NO_AUTO_MERGE_LABEL).toBe("oscar-factory:no-auto-merge");
    expect(taskFromLabels(["oscar-factory:review", NO_AUTO_MERGE_LABEL])).toEqual({ ok: true, task: "review" });
    expect(taskFromLabels([NO_AUTO_MERGE_LABEL])).toEqual({ ok: false, reason: null });
  });

  it("ignores the candidate flag, which the factory leaves on a candidate's ticket for good", () => {
    expect(taskFromLabels(["oscar-factory:deepen-refute", CANDIDATE_LABEL])).toEqual({ ok: true, task: "deepen-refute" });
    expect(taskFromLabels(["oscar-factory:implement", CANDIDATE_LABEL])).toEqual({ ok: true, task: "implement" });
    expect(taskFromLabels([CANDIDATE_LABEL])).toEqual({ ok: false, reason: null });
  });

  it("ignores tickets with no factory label", () => {
    expect(taskFromLabels(["Bug"])).toEqual({ ok: false, reason: null });
  });
});

describe("skillsFor", () => {
  it("ships implement the rules, the stack, evidence, implement and what it calls, code-review and pr", () => {
    expect(skillsFor("implement")).toEqual([
      "factory-rules", "factory-stack", "factory-evidence", "implement", "tdd", "codebase-design",
      "code-review", "pr",
    ]);
  });

  it("ships review the rules, the stack for running specs, and code-review: no evidence, no PR body", () => {
    expect(skillsFor("review")).toEqual(["factory-rules", "factory-stack", "code-review"]);
  });
});

describe("TASKS", () => {
  it("gives resolve the stack for specs, no browser, the branch on GitHub, and 30 minutes", () => {
    expect(TASKS.resolve).toMatchObject({ browser: false, stack: true, branch: "required", timeLimitMinutes: 30, onBulkParent: true });
    expect(skillsFor("resolve")).toEqual(["factory-rules", "factory-stack"]);
  });

  it("gives fix-ci the stack for running checks, no browser, the branch on GitHub, and 30 minutes", () => {
    expect(TASKS["fix-ci"]).toMatchObject({ browser: false, stack: true, branch: "required", timeLimitMinutes: 30, onBulkParent: true });
    expect(skillsFor("fix-ci")).toEqual(["factory-rules", "factory-stack"]);
  });

  it("gives implement the browser and the stack, and lets it create or update the branch", () => {
    expect(TASKS.implement).toMatchObject({ browser: true, stack: true, branch: "optional" });
  });

  it("gives review no browser, the stack for specs, and needs the branch on GitHub", () => {
    expect(TASKS.review).toMatchObject({ browser: false, stack: true, branch: "required" });
  });

  it("gives merge only the rules and its rubric: no browser, no stack, the branch read-only, and 10 minutes", () => {
    expect(TASKS.merge).toMatchObject({ browser: false, stack: false, branch: "read", timeLimitMinutes: 10, docs: ["rubric.md"] });
    expect(skillsFor("merge")).toEqual(["factory-rules"]);
  });

  it("gives both deepen tasks origin/main only, no stack and no browser, and only the scan a clock", () => {
    expect(TASKS["deepen-scan"]).toMatchObject({ browser: false, stack: false, branch: "none", timeLimitMinutes: 40, docs: [] });
    expect(TASKS["deepen-scan"].clock).not.toBeNull();
    expect(skillsFor("deepen-scan")).toEqual(["factory-rules", "improve-codebase-architecture", "codebase-design"]);
    expect(TASKS["deepen-refute"]).toMatchObject({ browser: false, stack: false, branch: "none", timeLimitMinutes: 20, docs: ["method.md"], clock: null });
    expect(skillsFor("deepen-refute")).toEqual(["factory-rules", "codebase-design", "improve-codebase-architecture"]);
  });

  it("gives qa the browser, the stack, the branch its ticket names, nothing pushed, and 60 minutes", () => {
    expect(TASKS.qa).toMatchObject({ browser: true, stack: true, branch: "none", timeLimitMinutes: 60, onBulkParent: false, clock: null });
    expect(skillsFor("qa")).toEqual(["factory-rules", "factory-stack"]);
    expect(TASKS.qa.base?.(ticket({ description: "**Branch:** production\n**Area:** Billing" }))).toBe("production");
    expect(TASKS.qa.base?.(ticket({ description: "Billing." }))).toBeNull();
  });

  it("gives explore the browser, the stack, origin/main only, and 20 minutes", () => {
    expect(TASKS.explore).toMatchObject({ browser: true, stack: true, branch: "none", timeLimitMinutes: 20 });
    expect(skillsFor("explore")).toEqual(["factory-rules", "factory-stack"]);
  });
});

describe("renderTemplate", () => {
  it("fills every placeholder", () => {
    expect(renderTemplate("{{a}} and {{ b }}", { a: "1", b: "2" })).toBe("1 and 2");
  });

  it("fails on a placeholder with no value", () => {
    expect(() => renderTemplate("{{missing}}", {})).toThrow(/missing/);
  });
});

describe("runner files", () => {
  const tasks = Object.keys(TASKS) as TaskName[];

  it("has a SKILL.md for every skill a task ships", () => {
    for (const task of tasks) {
      for (const skill of skillsFor(task)) {
        expect(fs.existsSync(path.join(SKILLS_DIR, skill, "SKILL.md")), skill).toBe(true);
      }
    }
  });

  it("has a prompt for every task that starts with the rules", () => {
    for (const task of tasks) expect(promptTemplate(task), task).toMatch(/^1\. `factory-rules`/m);
  });

  it("names every skill its task ships, so the prompt is the one place to read the order", () => {
    for (const task of tasks) {
      for (const skill of skillsFor(task)) expect(promptTemplate(task), `${task}: ${skill}`).toContain(`\`${skill}\``);
    }
  });

  it("ships every doc a task lists, and its prompt points at each one", () => {
    for (const task of tasks) {
      for (const doc of TASKS[task].docs) {
        expect(fs.existsSync(path.join(TASKS_DIR, task, doc)), `${task}: ${doc}`).toBe(true);
        expect(promptTemplate(task), `${task}: ${doc}`).toContain(`{{runDir}}/${doc}`);
      }
    }
  });

  it("has an extract prompt for every task with a structured pass", () => {
    // resolve and fix-ci have no pass: their resolution and fix are posted as written.
    for (const task of tasks.filter((t) => t !== "resolve" && t !== "fix-ci")) expect(fs.existsSync(path.join(TASKS_DIR, task, "extract.md")), task).toBe(true);
  });

  it("has Claude Code settings that parse, with every env value a string", () => {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    for (const [k, v] of Object.entries(settings.env ?? {})) expect(typeof v, k).toBe("string");
  });
});
