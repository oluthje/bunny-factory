# What reaches the runner

Each run gets its task's prompt and its task's skills, nothing else. Changing either needs no snapshot rebuild.

```
sandbox/
├── tasks/<task>/   one folder per task: prompt.md, the run's one entry point, plus any files the factory uses
└── skills/<skill>/ the skills runs upload to ~/.claude/skills/; which ones each task gets is in src/tasks.ts
```

**The prompt is the one place to read a task.** It lists every skill call, in order, always with the Skill tool except for a skill marked `disable-model-invocation`, which it reads by path (see the root `CLAUDE.md`; today only `implement`), and ends with the run's finish line. No skill tells the agent to go and read another skill; a skill that calls another (like `implement` → `tdd`) is an upstream copy, and the prompt names those too.

## Tasks

### `implement`

Starts from: the `oscar-factory:implement` label. Ends with: commits and a PR body; the factory opens one PR per changed repo, then queues a `review` run for a second, comment-only review.

```
tasks/implement/prompt.md
├── 1. oscar-factory-rules          headless decisions, time budget, origin/main as the fixed point, gaps
├── 2. oscar-factory-stack          the repos and the running Bunny stack: services, specs, login, known gaps
├── 3. oscar-factory-evidence       steps 1–2: classify the change, capture the "before" on unchanged code
├── 4. implement                    the ticket as the spec; its closing code-review is step 5
│   └── tdd
│       ├── tests.md, mocking.md
│       └── codebase-design
│           └── DEEPENING.md, DESIGN-IT-TWICE.md
├── 5. code-review                  per changed repo, against origin/main; fixes what it agrees with, commits
├── 6. oscar-factory-evidence       steps 3–5: capture the "after" on reviewed code, GIFs, the Evidence section
├── 7. pr                           the PR body, with Decisions and Gaps
└── Finish line                     commits with the ticket prefix, clean git status, the PR body written
```

### `review`

Starts from: an `implement` run that opened a PR, or the `oscar-factory:review` label; once per ticket either way. Ends with: a review file; the factory posts it. It only comments: it changes no code, so it doesn't start the Bunny stack or get `oscar-factory-stack`.

```
tasks/review/prompt.md
├── 1. oscar-factory-rules
├── 2. code-review                  per changed repo, against origin/main, with the ticket as the spec
├── 3. the review                   fixed headings: Standards / Spec verdicts, Decisions, rules it wanted
└── Finish line                     the review written, nothing changed

tasks/review/extract.md             not called by the agent: the factory resumes the session with it after
                                    the run, under `claude --json-schema`, for the findings that point at a
                                    line, checked again with the same zod schema (src/review.ts). If that
                                    fails, it resumes again with the error, up to 2 more times.
                                    It posts one GitHub review per open PR: the review as its body,
                                    those findings as inline comments (any outside the diff are dropped).
```

## Skills

| Skill | What it is | Tasks |
|---|---|---|
| `oscar-factory-rules` | The rules every run follows: headless decisions, time budget, fixed point, gaps | all |
| `oscar-factory-stack` | Reference for the Bunny stack in the runner: repos, services, specs, login, known gaps | `implement` |
| `oscar-factory-evidence` | Before-and-after screenshots or GIFs for a visual change | `implement` |
| `implement`, `tdd`, `codebase-design` | Matt Pocock's skills, copied from `~/development/.claude/skills` on 2026-11-18 | `implement` |
| `code-review` | Matt Pocock's, same copy | `implement`, `review` |
| `pr` | Dex Horthy's `show-me`, via `~/development/.claude/skills/pr` (see its `CREDITS.md`) | `implement` |

The `oscar-factory-` skills are ours. The others are **read-only copies**: refresh them from source, never edit them. To change how one behaves in a run, say so in the task's prompt, at the step that calls it (as `implement`'s prompt does to run `implement`'s closing `code-review` as a step of its own).

## Adding a task or a skill

- **A task**: add `tasks/<task>/prompt.md`, its entry in `TASKS` in `src/tasks.ts`, and its tree above.
- **A skill**: add `skills/<skill>/SKILL.md`, call it from a prompt's steps, list it under that task in `src/tasks.ts`, and add it to the tree above.

`test/tasks.test.ts` checks that every shipped skill has a `SKILL.md`, and that each prompt starts with `oscar-factory-rules` and names every skill its task ships.
