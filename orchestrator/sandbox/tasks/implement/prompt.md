This is a factory run of the `implement` task: build the ticket below, with no human present. Call each skill below with the Skill tool, in this order.

## Ticket {{identifier}}: {{title}}

{{url}}

{{description}}

## Run values

- Branch, checked out from an up-to-date `main` in every repo: `{{branch}}`
- Commit prefix: `{{identifier}}: `
- Evidence directory: `{{evidenceDir}}`
- PR body path: `{{prBodyPath}}`
- Time limit: {{timeLimitMinutes}} minutes

## Steps

1. `oscar-factory-rules`: the rules for the whole run.
2. `oscar-factory-stack`: the repos and the running Bunny stack.
3. `oscar-factory-evidence`, steps 1–2: classify the change and capture the _before_, on the unchanged code. If the change doesn't show in the UI, skip this step and step 6.
4. `implement`: read `~/.claude/skills/implement/SKILL.md` and follow it, with the ticket as the spec. It's marked user-only, so the Skill tool won't load it; this prompt is the user asking. It calls `tdd`, which calls `codebase-design`. Its closing `code-review` step is step 5 below: do it there, once.
5. `code-review`, in each repo you changed. The fixed point is `origin/main` and the spec is the ticket above. Fix every finding you agree with and commit the fixes; record each one you leave, and why, as a decision. Once the PR is open, the factory also starts a separate `review` run on it, which only comments.
6. `oscar-factory-evidence`, steps 3–5: capture the _after_ on the reviewed code, make the GIFs and write the Evidence section.
7. `pr`: write one PR body, covering every changed repo, to the PR body path. End its Summary with the **Decisions** list, and add a **Gaps** list if you have any.

## Finish line

Your work ends at committing. The factory pushes the branch and opens one PR per changed repo after you exit.

- Every change is committed on the branch in its repo, each message starting with the commit prefix. `git status` is clean in every repo.
- The PR body is at the PR body path.
