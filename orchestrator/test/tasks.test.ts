import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPrompt, SKILLS_DIR, TASKS_DIR } from "../src/prompt.ts";
import { IN_PROGRESS_LABEL, renderTemplate, skillsFor, taskFromLabels, TASKS } from "../src/tasks.ts";

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
      reason: "Unknown factory label `oscar-factory:deploy`. Known: `oscar-factory:implement`, `oscar-factory:review`.",
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

  it("ignores tickets with no factory label", () => {
    expect(taskFromLabels(["Bug"])).toEqual({ ok: false, reason: null });
  });
});

describe("skillsFor", () => {
  it("ships implement the rules, the stack, evidence, implement and what it calls, code-review and pr", () => {
    expect(skillsFor("implement")).toEqual([
      "oscar-factory-rules", "oscar-factory-stack", "oscar-factory-evidence", "implement", "tdd", "codebase-design",
      "code-review", "pr",
    ]);
  });

  it("ships review only the rules and code-review: it starts no stack and writes no PR body", () => {
    expect(skillsFor("review")).toEqual(["oscar-factory-rules", "code-review"]);
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

describe("sandbox files", () => {
  it("has a SKILL.md for every skill a task ships", () => {
    for (const task of Object.keys(TASKS) as (keyof typeof TASKS)[]) {
      for (const skill of skillsFor(task)) {
        expect(fs.existsSync(path.join(SKILLS_DIR, skill, "SKILL.md")), skill).toBe(true);
      }
    }
  });

  const render = (task: keyof typeof TASKS) =>
    buildPrompt({
      task,
      ticket: {
        id: "1", identifier: "REC-1", title: "T", description: "D", url: "U",
        branchName: "oscar/rec-1-t", labels: [], updatedAt: "2026-11-18T00:00:00.000Z",
      },
      evidenceDir: "/home/daytona/artifacts/evidence",
      prBodyPath: "/home/daytona/artifacts/pr-body.md",
      reviewPath: "/home/daytona/artifacts/review.md",
    });

  it("has a prompt for every task, rendered with no placeholder left", () => {
    for (const task of Object.keys(TASKS) as (keyof typeof TASKS)[]) {
      const prompt = render(task);
      expect(prompt, task).toMatch(/^1\. `oscar-factory-rules`/m);
      expect(prompt, task).toContain("`oscar/rec-1-t`");
      expect(prompt, task).not.toMatch(/\{\{/);
    }
  });

  it("names every skill its task ships, so the prompt is the one place to read the order", () => {
    for (const task of Object.keys(TASKS) as (keyof typeof TASKS)[]) {
      for (const skill of skillsFor(task)) expect(render(task), `${task}: ${skill}`).toContain(`\`${skill}\``);
    }
  });

  it("has implement review and fix its own work as a numbered step", () => {
    expect(render("implement")).toMatch(/^5\. `code-review`/m);
  });

  it("tells review to change nothing", () => {
    expect(render("review")).toContain("You changed nothing");
  });

  it("asks the review for code-review, the review path and the missing-rules section", () => {
    const prompt = render("review");
    expect(prompt).toContain("`code-review`");
    expect(prompt).toContain("`/home/daytona/artifacts/review.md`");
    expect(prompt).toContain("## Rules this review wanted and could not find");
    expect(prompt).toContain("The retro reads this list.");
  });

  it("asks the review for the verdict headings the factory parses", () => {
    const prompt = render("review");
    expect(prompt).toContain("## Standards: PASS | CHANGES REQUESTED");
    expect(prompt).toContain("## Spec: PASS | CHANGES REQUESTED");
  });

  it("has the review's extraction prompt", () => {
    expect(fs.existsSync(path.join(TASKS_DIR, "review", "extract.md"))).toBe(true);
  });
});
