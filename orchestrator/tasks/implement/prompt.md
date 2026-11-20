This is a factory run of the `implement` task, in **{{mode}}** mode: build the ticket below, with no human present. Call each skill below with the Skill tool, in this order.

- **create**: there is no PR yet. Build the ticket from `main`.
- **update**: the ticket's branch and PRs already exist, and Oscar has left feedback on them. Build on the branch. The ticket is still the spec; the feedback section below is what to change this round.

## Ticket {{identifier}}: {{title}}

{{url}}

{{description}}

{{thread}}

{{feedback}}

## Run values

- Mode: {{mode}}
- Branch `{{branch}}`, {{start}}
- Commit prefix: `{{identifier}}: `
- Evidence directory: `{{evidenceDir}}`
- PR body path: `{{prBodyPath}}`
- Time limit: {{timeLimitMinutes}} minutes

## Steps

1. `factory-rules`: the rules for the whole run.
2. `factory-stack`: the repos and the running Bunny stack.
3. `factory-evidence`, steps 1–2: classify the change and capture the _before_, on the unchanged code.
   - **update**: the _before_ is still `origin/main`, so the PR's evidence always shows main against the finished change. In each repo the branch changes, `git checkout --detach origin/main`. Let the stack reload, and `bunny-stack restart` a service whose page doesn't. Capture the screens, then `git checkout {{branch}}` in each repo. If a page on `main` won't render against the branch's migrated database, record a gap.
4. `implement`: read `~/.claude/skills/implement/SKILL.md` and follow it. It's marked user-only, so the Skill tool won't load it; this prompt is the user asking. It calls `tdd`, which calls `codebase-design`. Its closing `code-review` step is step 5 below: do it there, once.
   - **update**: keep the ticket in view: what the feedback doesn't touch must still meet it. Where an item contradicts the ticket, follow the item and record the conflict as a decision, so the next review knows the change was asked for. Act on every review thread, PR comment and ticket comment in it. Make each change, decline it with a reason, or answer it if it's a question. Record each decline as a decision.
5. `code-review`, in each repo you changed. On an update this covers the whole branch, not just this round. Fix every finding you agree with; record each one you leave, and why, as a decision. After this run, the factory starts a separate `review` run, which fixes what it's sure of and comments on the rest.
6. `factory-evidence`, steps 3–4: capture the _after_ on the reviewed code and write the Evidence section.
7. `pr`: write one PR body, covering every changed repo, to the PR body path. Read `{{runDir}}/pr-guide.md` first and follow it. The body replaces the PR's, so on an update it describes the whole PR, not this round.

## Finish line

Your work ends at committing.

- Every change is committed on the branch in its repo, each message starting with the commit prefix. `git status` is clean in every repo.
- **update**: the branch only gains commits. No rebase, amend, reset or squash: the factory pushes without force, and Oscar reviews the new commits.
- The PR body is at the PR body path.
- **update**: after you exit, the factory resumes this session and asks for one reply per review thread. Have each thread's outcome ready.
