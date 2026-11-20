---
name: factory-task-improvement
description: Audit a factory task's prompt and everything it loads for duplicated instructions and no-op lines, and suggest what to trim. Use when the user wants to improve, tighten or dedupe a task.
---

A run's context is everything its prompt loads: `orchestrator/tasks/<task>/prompt.md`, the skills it calls, and anything those point at. The same instruction said twice wastes context and drifts apart over time, and a line that changes nothing the model does is pure cost. Find both and say what to trim.

## 1. Map what the task loads

Start at `orchestrator/tasks/<task>/prompt.md` and follow every pointer:

- each skill the prompt calls, at `orchestrator/runner-files/skills/<skill>/SKILL.md`;
- every file a skill links to or tells the agent to read (e.g. `tdd` → `tests.md`, `codebase-design`), recursively;
- the task's own docs, listed in `docs` in `orchestrator/tasks/<task>/index.ts`;
- `extract.md`, if the task has one.

Note which files are always loaded and which are read only when a step comes up. The tree in `orchestrator/tasks/README.md` is a starting point; trust the files over it.

## 2. Find duplicates

Look for the same instruction, rule or fact in two or more files, even when worded differently. Also flag contradictions: two files saying different things about the same thing.

## 3. Find no-ops

Look for lines that change nothing about what the model does: things it already does unprompted (be thorough, write clean code, read a file before editing it), vague exhortations with no concrete action (be careful, think hard, aim for high quality), and restatements of what the surrounding text already makes obvious. Test each: would a run behave differently without this line? If not, it's a no-op.

## 4. Suggest fixes

For each duplicate, pick one home and say what to remove elsewhere. For each no-op, suggest deleting it.

**Never suggest editing a skill not prefixed `factory-`.** Those are read-only upstream copies (Matt Pocock's, Dex Horthy's). When one duplicates or conflicts with our text, the fix goes in our files: drop our copy if upstream already says it, or override upstream in the prompt, at the step that calls that skill. To customize a read-only skill beyond that, suggest a `factory-` wrapper skill that references the read-only one and adds our changes (rules in `orchestrator/runner-files/README.md`, "Wrapping a read-only skill"). Don't report no-ops in upstream skills.

## Output

Two lists. **Duplicates**: the instruction, every place it appears (`file:line`), the suggested home, and what to delete or change. **No-ops**: the line (`file:line`) and why it has no effect. Make no edits unless the user asks.
