# What reaches the runner

Each run gets its task's prompt, its task's skills and Claude Code's settings, nothing else. Changing any of them needs no snapshot rebuild.

```
sandbox/
├── tasks/<task>/   one folder per task: prompt.md, the run's one entry point, plus any files the factory uses
├── skills/<skill>/ the skills runs upload to ~/.claude/skills/; which ones each task gets is in src/tasks.ts
└── settings.json   Claude Code's user settings, uploaded to ~/.claude/settings.json for every task
```

`settings.json` holds what Claude Code reads at startup, not what the agent should do (that's the prompt):
- `DISABLE_AUTOUPDATER`: the snapshot pins Claude Code's version; a run doesn't update itself.
- `BASH_DEFAULT_TIMEOUT_MS` (10 min) and `BASH_MAX_TIMEOUT_MS` (30 min): spec runs outlast the 2-minute default.

Permissions stay on the command line (`--dangerously-skip-permissions` in `src/functions/run-ticket.ts`), and the Playwright MCP server stays in `--mcp-config`: Claude Code doesn't read MCP servers from `settings.json`.

**The prompt is the one place to read a task.** It lists every skill call, in order, always with the Skill tool except for a skill marked `disable-model-invocation`, which it reads by path (see the root `CLAUDE.md`; today only `implement`), and ends with the run's finish line. No skill tells the agent to go and read another skill; a skill that calls another (like `implement` → `tdd`) is an upstream copy, and the prompt names those too.

## Tasks

Runs start only from a ticket's `oscar-factory:<task>` label, and every run ends by moving the ticket's labels on. That is how one task hands off to the next: see `src/transitions.ts`.

### `implement`

Starts from: the `oscar-factory:implement` label. The factory picks one of two modes:
- **create** when the ticket's branch isn't on GitHub yet: it branches from `main`.
- **update** when it is: it builds on the branch and acts on Oscar's feedback, with the ticket still the spec. The feedback is Oscar's unresolved review threads where Oscar has the last word, plus Oscar's PR comments and ticket comments. Where an item contradicts the ticket, the agent follows the item and records the conflict as a decision.

Ends with: commits and a PR body. The factory pushes without force, opens a draft PR per newly changed repo, and replaces the body of the open ones. On an update it also posts a reply on each thread. If the run pushed commits, the ticket's label becomes `oscar-factory:review`.

```
tasks/implement/prompt.md          one prompt for both modes: {{mode}}, {{start}} and {{feedback}} differ
├── 1. oscar-factory-rules          headless decisions, time budget, origin/main as the fixed point, gaps
├── 2. oscar-factory-stack          the repos and the running Bunny stack: services, specs, login, known gaps
├── 3. oscar-factory-evidence       steps 1–2: classify the change, capture the "before" on origin/main
│                                   (an update checks out origin/main to capture it, then returns)
├── 4. implement                    the ticket as the spec; an update acts on the feedback on top of it;
│   │                               its closing code-review is step 5
│   └── tdd
│       ├── tests.md, mocking.md
│       └── codebase-design
│           └── DEEPENING.md, DESIGN-IT-TWICE.md
├── 5. code-review                  per changed repo, against origin/main; fixes what it agrees with, commits
├── 6. oscar-factory-evidence       steps 3–5: capture the "after" on reviewed code, GIFs, the Evidence section
├── 7. pr                           the PR body for the whole PR, with Decisions and Gaps
└── Finish line                     commits with the ticket prefix, history only gains commits, clean git
                                    status, the PR body written

tasks/implement/extract.md          update only, and only with review threads: not called by the agent. The
                                    factory resumes the session with it after the run, under `claude
                                    --json-schema`, for one reply per thread (done, declined or answered),
                                    checked again with the same zod schema (src/replies.ts), retried up to
                                    2 times. It posts each reply on its thread.
```

### `review`

Starts from: the `oscar-factory:review` label, which an `implement` run that pushed commits sets, or Oscar does.

Ends with: fix commits and a review file. The factory pushes the fixes, posts the review, and marks the PRs ready for review. Then the ticket waits on Oscar.

It fixes only the findings it's sure of and comments on the rest. It runs specs, so it starts the Bunny stack and gets `oscar-factory-stack`. It gets no browser.

```
tasks/review/prompt.md
├── 1. oscar-factory-rules
├── 2. oscar-factory-stack          for running specs
├── 3. code-review                  per changed repo, against origin/main, with the ticket as the spec,
│                                   read with the PR body's Decisions (the prompt carries the open PR's
│                                   body as context, e.g. for a change Oscar asked for that departs from it)
├── 4. fix what it's sure of        one clear fix Oscar would plainly accept; the rest stay findings,
│                                   product calls marked "Decision needed"
├── 5. the review                   fixed headings: Fixed / Standards / Spec verdicts (after its fixes),
│                                   Decisions, rules it wanted
└── Finish line                     the review written, fixes committed with the ticket prefix, no push

tasks/review/extract.md             not called by the agent: the factory resumes the session with it after
                                    the run, under `claude --json-schema`, for the findings it left that
                                    point at a line, checked again with the same zod schema (src/review.ts).
                                    If that fails, it resumes again with the error, up to 2 more times.
                                    After pushing the fixes, it posts one GitHub review per open PR on the
                                    new head: the review as its body, those findings as inline comments (any
                                    outside the diff are dropped).
```

## Skills

| Skill | What it is | Tasks |
|---|---|---|
| `oscar-factory-rules` | The rules every run follows: headless decisions, time budget, fixed point, gaps | all |
| `oscar-factory-stack` | Reference for the Bunny stack in the runner: repos, services, specs, login, known gaps | `implement`, `review` |
| `oscar-factory-evidence` | Before-and-after screenshots or GIFs for a visual change | `implement` |
| `implement`, `tdd`, `codebase-design` | Matt Pocock's skills, copied from `~/development/.claude/skills` on 2026-11-18 | `implement` |
| `code-review` | Matt Pocock's, same copy | `implement`, `review` |
| `pr` | Dex Horthy's `show-me`, via `~/development/.claude/skills/pr` (see its `CREDITS.md`) | `implement` |

The `oscar-factory-` skills are ours. The others are **read-only copies**: refresh them from source, never edit them. To change how one behaves in a run, say so in the task's prompt, at the step that calls it (as `implement`'s prompt does to run `implement`'s closing `code-review` as a step of its own).

## Adding a task or a skill

- **A task**: add `tasks/<task>/prompt.md`, its entry in `TASKS` in `src/tasks.ts`, its row in `CHAIN` in `src/transitions.ts`, its Linear label, and its tree above.
- **A skill**: add `skills/<skill>/SKILL.md`, call it from a prompt's steps, list it under that task in `src/tasks.ts`, and add it to the tree above.

`test/tasks.test.ts` checks that every shipped skill has a `SKILL.md`, and that each prompt starts with `oscar-factory-rules` and names every skill its task ships.
