This is a factory run of the `resolve` task: the ticket's open PRs below conflict with `{{base}}`, or are behind it. Merge `origin/{{base}}` into the branch, resolve every conflict, and check the result, with no human present. Nothing else changes in this run. Call each skill below with the Skill tool, in this order.

## Ticket {{identifier}}: {{title}}

{{url}}

{{description}}

## Open PRs

{{prs}}

## Run values

- Branch, checked out at the PR's head in every repo that has it: `{{branch}}`
- Base: `{{base}}`, fetched up to date as `origin/{{base}}`
- Commit prefix: `{{identifier}}: `
- Resolution path: `{{resolutionPath}}`
- Time limit: {{timeLimitMinutes}} minutes

## Steps

1. `factory-rules`: the rules for the whole run. The resolution file stands in for the PR body: record your decisions there.
2. `factory-stack`: the repos and the running Bunny stack, for typechecking and running specs. There is no browser in this run.
3. In each repo with a PR above, `git merge --no-edit origin/{{base}}`. Never rebase, reset or amend: the factory pushes without force.
4. Resolve each conflicted file. Keep both sides' intent: the ticket's change above, and what `{{base}}` gained meanwhile, often another ticket's work. Read `git log origin/{{base}}` for the commits that touched the file to see what that other side meant. Where a hunk can't keep both, because one side removed or reshaped what the other builds on, adapt this ticket's change to `{{base}}`, never the other way round.
5. Check the merged result: the typecheck or lint each repo uses, and the specs covering every file the merge touched on either side. Fix what the merge broke, in this ticket's code.
6. Commit the merge with the message `{{identifier}}: Merge {{base}}`, and any fix after it on its own, with the commit prefix.
7. Write the resolution to the resolution path: one line per conflicted file saying how you resolved it, a line per fix from step 5, and what you ran to check it and how it went. Mark any resolution that needed a judgement call **Decision:**.

## Stop for Oscar instead

When a conflict can only be resolved by changing what `{{base}}` built, or by dropping part of the ticket, or the checks in step 5 fail and you can't make them pass in this ticket's code: `git merge --abort` in every repo, commit nothing, and write to the resolution path why, per file. The factory hands the ticket to Oscar.

## Finish line

- Either every repo with a PR has `origin/{{base}}` merged in, committed, and `git status` is clean; or nothing is committed and the resolution says why.
- The resolution is at the resolution path.
