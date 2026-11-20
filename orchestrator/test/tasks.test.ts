import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HUMAN_NEEDED_LABEL, IN_PROGRESS_LABEL } from "../src/labels.ts";
import { promptTemplate, renderTemplate, SETTINGS_FILE, SKILLS_DIR, TASKS_DIR } from "../src/prompt.ts";
import { skillsFor, taskFromLabels, TASKS, type TaskName } from "../src/tasks.ts";

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
      reason: "Unknown factory label `oscar-factory:deploy`. Known: `oscar-factory:implement`, `oscar-factory:review`, `oscar-factory:explore`.",
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
  it("gives implement the browser and lets it create or update the branch", () => {
    expect(TASKS.implement).toMatchObject({ browser: true, branch: "optional" });
  });

  it("gives review no browser, and needs the branch on GitHub", () => {
    expect(TASKS.review).toMatchObject({ browser: false, branch: "required" });
  });

  it("gives explore the browser, origin/main only, and 20 minutes", () => {
    expect(TASKS.explore).toMatchObject({ browser: true, branch: "none", timeLimitMinutes: 20 });
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

  it("has an extract prompt for every task, for its structured pass", () => {
    for (const task of tasks) expect(fs.existsSync(path.join(TASKS_DIR, task, "extract.md")), task).toBe(true);
  });

  it("has Claude Code settings that parse, with every env value a string", () => {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    for (const [k, v] of Object.entries(settings.env ?? {})) expect(typeof v, k).toBe("string");
  });
});
