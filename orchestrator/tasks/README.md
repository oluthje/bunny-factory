# Tasks

One folder per task, holding everything the task owns (see [docs/coding-standards.md](../../docs/coding-standards.md)):

```
tasks/
├── index.ts            the registry: every task, by name
└── <task>/
    ├── prompt.md       the run's one entry point; reaches the runner
    ├── extract.md      the structured pass's prompt; reaches the runner
    ├── *.md            docs the prompt points at, listed in the task's `docs`; reach the runner
                        at {{runDir}}/<file>, read when their step comes up
    ├── index.ts        the task: its skills, browser, branch, time limit, and its part of the run
    │                   (inputs before it, the structured pass, what it does with the work, what it hands off to)
    ├── prompt.ts       its own placeholders in prompt.md (pure)
    └── *.ts, *.test.ts its pure logic, tested next to it
```

The engine that runs every task is in `src/`, and knows no task by name: the contract is the `Task` type in `src/task.ts`. Skills and Claude Code's settings are in [../runner-files/](../runner-files/README.md).


Runs start only from a ticket's `oscar-factory:<task>` label, and every run ends by moving the ticket's labels on. Each task decides what comes next (its `conclude` sets `next`: a task, `human` to wait on Oscar, or `done`), and `src/transitions.ts` moves the labels, holding back any run that didn't succeed. A task's `prepare` can also end the run before any runner, with a `Stop`.

The chain: `explore` (easy call) → `implement` (pushed commits) → `review` (posted on a PR) → `merge` (merged: done).

### `implement`

Starts from: the `oscar-factory:implement` label. The factory picks one of two modes:
- **create** when the ticket's branch isn't on GitHub yet: it branches from `main`.
- **update** when it is: it builds on the branch and acts on Oscar's feedback, with the ticket still the spec. The feedback is Oscar's unresolved review threads where Oscar has the last word, plus Oscar's PR comments and ticket comments. Where an item contradicts the ticket, the agent follows the item and records the conflict as a decision.

Ends with: commits and a PR body. The factory pushes without force, opens a draft PR per newly changed repo, and replaces the body of the open ones. On an update it also posts a reply on each thread. If the run pushed commits, the ticket's label becomes `oscar-factory:review`.

```
implement/prompt.md          one prompt for both modes: {{mode}}, {{start}} and {{feedback}} differ
├── 1. factory-rules                headless decisions, time budget, origin/main as the fixed point, gaps
├── 2. factory-stack                the repos and the running Bunny stack: services, specs, login, known gaps
├── 3. factory-evidence             steps 1–2: classify the change, capture the "before" on origin/main
│                                   (an update checks out origin/main to capture it, then returns)
├── 4. implement                    the ticket as the spec; an update acts on the feedback on top of it;
│   │                               its closing code-review is step 5
│   └── tdd
│       ├── tests.md, mocking.md
│       └── codebase-design
│           └── DEEPENING.md, DESIGN-IT-TWICE.md
├── 5. code-review                  per changed repo, against origin/main; fixes what it agrees with, commits
├── 6. factory-evidence             steps 3–4: capture the "after" on reviewed code, the Evidence section
├── 7. pr                           the PR body for the whole PR, held to implement/pr-guide.md:
│                                   plain opening, labels written out, ≤5 Decisions, Gaps, the rest
│                                   in collapsed Run notes, the Evidence section as step 6 wrote it
└── Finish line                     commits with the ticket prefix, history only gains commits, clean git
                                    status, the PR body written

implement/extract.md          update only, and only with review threads: not called by the agent. The
                                    factory resumes the session with it after the run, under `claude
                                    --json-schema`, for one reply per thread (done, declined or answered),
                                    checked again with the same zod schema (`replies.ts`), retried up to
                                    2 times. It posts each reply on its thread.
```

### `review`

Starts from: the `oscar-factory:review` label, which an `implement` run that pushed commits sets, or Oscar does.

Ends with: fix commits and a review file. The factory pushes the fixes, posts the review, and marks the PRs ready for review. If it posted on a PR, the ticket's label becomes `oscar-factory:merge`, whatever the verdict: merge weighs the findings itself. With no PR to post on, the ticket waits on Oscar.

It fixes only the findings it's sure of and comments on the rest. It runs specs, so it starts the Bunny stack and gets `factory-stack`. It gets no browser.

```
review/prompt.md
├── 1. factory-rules
├── 2. factory-stack                for running specs
├── 3. code-review                  per changed repo, against origin/main, with the ticket as the spec,
│                                   read with the PR body's Decisions (the prompt carries the open PR's
│                                   body as context, e.g. for a change Oscar asked for that departs from it)
├── 4. fix what it's sure of        one clear fix Oscar would plainly accept; the rest stay findings,
│                                   product calls marked "Decision needed", each with its options
├── 5. the review                   fixed headings: Fixed / Standards / Spec verdicts (after its fixes),
│                                   Decisions, rules it wanted
└── Finish line                     the review written, fixes committed with the ticket prefix, no push

review/extract.md             not called by the agent: the factory resumes the session with it after
                                    the run, under `claude --json-schema`, for the findings it left that
                                    point at a line and its "Decision needed" findings as question cards,
                                    checked again with the same zod schema (`review.ts`). If that fails,
                                    it resumes again with the error, up to 2 more times.
                                    After pushing the fixes, it posts one GitHub review per open PR on the
                                    new head: the review as its body, those findings as inline comments (any
                                    outside the diff are dropped). The ticket gets one line pointing at the
                                    PRs. Only with no PR to post on do the question cards and the folded
                                    review go on the ticket.
```

### `merge`

Starts from: the `oscar-factory:merge` label, which a `review` run that posted on a PR sets, or Oscar does.

Ends with: the ticket's PRs merged, all of them or none. Merged, the ticket keeps no factory label (`next: "done"`). Anything else waits on Oscar, with the reason on the ticket and on each PR.

Before any runner, `prepare` stops the run when the ticket has Oscar's flag label `oscar-factory:no-auto-merge`, has no open PR, or has the branch in a repo with no PR. Then it waits for CI on every PR, polling every 2 minutes for up to 30, and stops on red or a timeout. The agent gets no stack and no browser, only `factory-rules` and `rubric.md`, and 10 minutes. It changes nothing.

After the run, the orchestrator checks every PR again itself (`gates.ts`): open, not a draft, not into `production`, mergeable, CI green, head unchanged since the agent read it, no flag label, nothing pushed by the run. With `FACTORY_MERGE_DRY_RUN` on, the default, it only says what it would merge. Otherwise it merges in order, each with a merge commit guarded by the head the agent judged, and deletes the branch. A merge that fails after another went in stops there with a partial-merge note: merges aren't undone.

```
merge/prompt.md              each open PR with its CI, body, reviews, unresolved threads and comments;
                                   Oscar's ticket comments and the explore findings
├── 1. factory-rules
├── 2. merge/rubric.md             what an easy call is: clear ticket, diff does just that, small,
│                                  tested, local; never a question, an open Decision needed, a one-way
│                                  door, shared framework code, money rules, or auth
├── 3–5. read and judge            the whole diff per repo, against the ticket; review's findings as
│                                  evidence, not the verdict; the PRs judged as one change
├── 6. the verdict                 fixed headings: Verdict / one per PR / Order
└── Finish line                    verdict written, no commits, clean git status

merge/extract.md             not called by the agent: the factory resumes the session with it under
                                   `claude --json-schema` for `{ summary, prs: [{ repo, verdict, reason }],
                                   order }`, checked again with the same zod schema (`verdict.ts`), which
                                   also wants every open PR judged once, retried up to 2 times. An order
                                   that doesn't name every repo once falls back to api, app, portal,
                                   kong (`order.ts`).
```

### `explore`

Starts from: the `oscar-factory:explore` label, which Oscar sets. It's optional: a ticket can go straight to `implement`.

Ends with: findings and a verdict, and no commits. The factory posts the findings on the ticket, with any screenshots inline, as a comment tagged `explore findings`, with its open questions as question cards above them. On `easy-call` the ticket's label becomes `oscar-factory:implement`; on `human-needed`, a timeout or no readable verdict, it waits on Oscar.

It works on `origin/main` only (`branch: "none"`): every repo is detached, the ticket's branch is never fetched, and nothing is pushed. It gets the browser for UI claims, and 20 minutes.

```
explore/prompt.md            Oscar's comments on the ticket, and the last findings if it was explored before
├── 1. factory-rules
├── 2. factory-stack
├── 3–5. claims, evidence, map      each claim checked against the code (file:line, a reproduction, or a
│                                   screenshot), the 2–3 places it touches, schema change, one- or two-way door
├── 6. verdict                      easy-call: clear, uncontested, two-way; anything else human-needed
├── 7. the findings                 fixed headings: Verdict / Claims / Blast radius / Door / Open questions /
│                                   Decisions (and Gaps); each open question has options and,
│                                   whenever what the user sees differs, a side-by-side mockup
└── Finish line                     findings written, no commits, clean git status

explore/extract.md           not called by the agent: the factory resumes the session with it under
                                   `claude --json-schema` for `{ verdict, questions }`, checked again with the
                                   same zod schema (`findings.ts`), retried up to 2 times. The questions are
                                   rendered as cards (`src/questions.ts`) above the findings, which fold
                                   once the cards carry what Oscar must answer, or on an easy call.
```

An `implement` run that creates gets Oscar's ticket comments, which refine the ticket, and the latest findings if there are any, as context, not the spec. Comments after the findings answer their open questions. An update's feedback skips them, as it skips every factory comment.

## Adding a task

1. Add `tasks/<task>/` with `prompt.md`, `extract.md` if it has a structured pass, `prompt.ts` for its placeholders, and `index.ts` exporting its `Task`.
2. Add it to `TaskName` and `TASKS` in `tasks/index.ts`.
3. Add its Linear label, `oscar-factory:<task>`, and its tree above.

If it needs something the engine doesn't offer yet, add a hook to `Task` that any task could use, in its own commit. `test/boundaries.test.ts` fails if `src/` imports a task's files, or if a task imports another task's `index.ts` or the registry.
