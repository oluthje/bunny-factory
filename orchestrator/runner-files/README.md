# What reaches the runner

Each run gets its task's prompt (and extract prompt), its task's skills and Claude Code's settings, nothing else. Changing any of them needs no snapshot rebuild.

The prompt's Linear uploads come along too: a mockup in the ticket or a screenshot in a comment needs the Linear API key, which the runner never holds. The orchestrator downloads each one to `~/run/linear-uploads/` and points the prompt at that copy (`src/linear-uploads.ts`).

```
runner-files/
├── skills/<skill>/ the skills runs upload to ~/.claude/skills/; which ones each task gets is its `skills` in tasks/<task>/index.ts
└── settings.json   Claude Code's user settings, uploaded to ~/.claude/settings.json for every task
tasks/<task>/
├── prompt.md       the run's one entry point
└── extract.md      the structured pass's prompt, when the task has one
```

Everything else in `tasks/<task>/` is orchestrator code, and stays on the orchestrator. The tasks, and each prompt's tree, are in [../tasks/README.md](../tasks/README.md).

`settings.json` holds what Claude Code reads at startup, not what the agent should do (that's the prompt):
- `DISABLE_AUTOUPDATER`: the snapshot pins Claude Code's version; a run doesn't update itself.
- `BASH_DEFAULT_TIMEOUT_MS` (10 min) and `BASH_MAX_TIMEOUT_MS` (30 min): spec runs outlast the 2-minute default.

Permissions stay on the command line (`--dangerously-skip-permissions` in `src/functions/run-ticket.ts`), and the Playwright MCP server stays in `--mcp-config`, passed only to tasks with `browser: true`: Claude Code doesn't read MCP servers from `settings.json`.

**The prompt is the one place to read a task.** It lists every skill call, in order, always with the Skill tool except for a skill marked `disable-model-invocation`, which it reads by path (see the root `CLAUDE.md`; today `implement` and `improve-codebase-architecture`), and ends with the run's finish line. No skill tells the agent to go and read another skill, except a wrapper calling the skill it wraps (below). An upstream copy that calls another (like `implement` → `tdd`) is named in the prompt too.

## Skills

| Skill | What it is | Tasks |
|---|---|---|
| `factory-rules` | The rules every run follows: headless decisions, time budget, fixed point, gaps | all |
| `factory-stack` | Reference for the Bunny stack in the runner: repos, services, specs, login, runner gaps | `implement`, `review`, `explore`, `resolve`, `fix-ci`, `qa` |
| `factory-evidence` | Before-and-after screenshots or videos for a visual change | `implement` |
| `implement`, `tdd`, `codebase-design` | Matt Pocock's skills, copied from `~/development/.claude/skills` on 2026-11-18 | `implement`; `codebase-design` also `deepen-scan`, `deepen-refute` |
| `code-review` | Matt Pocock's, same copy | `implement`, `review` |
| `improve-codebase-architecture` | Matt Pocock's, copied from `.agents/skills` on 2026-11-20 (`skills-lock.json` has the commit) | `deepen-scan`, `deepen-refute` (only its `HTML-REPORT.md`) |
| `pr` | Dex Horthy's `show-me`, via `~/development/.claude/skills/pr` (see its `CREDITS.md`) | `implement` |

The `factory-` skills are ours. The others are **read-only copies**: refresh them from source, never edit them. To change how one behaves in a run, say so in the task's prompt, at the step that calls it (as `implement`'s prompt does to run `implement`'s closing `code-review` as a step of its own).

## Wrapping a read-only skill

When the change is more than a line or two, or several tasks need the same change, wrap the skill instead: a `factory-<skill>` skill that calls the read-only one with the Skill tool and says what to do differently.

- One level only: a wrapper calls the skill it wraps and nothing else, and nothing wraps a wrapper.
- The task ships both, and the prompt names both at the step ("call `factory-code-review`, which wraps `code-review`"). The task's tree in `tasks/README.md` shows the wrapped skill under the wrapper.

## Adding a skill

Add `skills/<skill>/SKILL.md`, call it from a prompt's steps, add it to that task's `skills` in `tasks/<task>/index.ts`, and add it to the task's tree in `tasks/README.md`.

`test/tasks.test.ts` checks that every shipped skill has a `SKILL.md`, and that each prompt starts with `factory-rules` and names every skill its task ships.
