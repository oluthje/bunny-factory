This is a factory run of the `fix-ci` task: CI failed on the ticket's open PRs below. Find why, fix it in this ticket's code, and check the fix, with no human present. Nothing else changes in this run. Call each skill below with the Skill tool, in this order.

## Ticket {{identifier}}: {{title}}

{{url}}

{{description}}

## Failed checks

{{checks}}

## Run values

- Branch, checked out at the PR's head in every repo that has it: `{{branch}}`
- Base: `{{base}}`, fetched up to date as `origin/{{base}}`
- Commit prefix: `{{identifier}}: `
- Fix path: `{{fixPath}}`
- Fix round: {{round}}
- Time limit: {{timeLimitMinutes}} minutes

## Steps

1. `factory-rules`: the rules for the whole run. The fix file stands in for the PR body: record your decisions there.
2. `factory-stack`: the repos and the running Bunny stack, for running the failed checks. There is no browser in this run.
3. Read each failed check's log above for the first real error. Find the command CI ran for it in the repo's CI config (`.github/workflows/`, and the `package.json` or `bin/` script it calls), and run that command, or the narrowest part of it that covers the error, on the branch. Reproduce the failure before changing anything.
4. Decide whose failure it is. CI runs on the PR merged into `{{base}}`, so the cause can be on either side. Check out `origin/{{base}}` detached, run the same command there, then go back to `{{branch}}`. If it fails there too, the base is broken and this ticket can't fix it: stop for Oscar (below). Don't reach into code the ticket didn't touch to make the base pass.
5. Fix the cause in this ticket's code: the smallest change that makes the check pass while still doing what the ticket asks. Never skip, delete or loosen a test or a lint rule to get green, and never mark a test as flaky: if a test is wrong, say why in the fix file and mark it **Decision:**.
6. Run the command from step 3 again until it passes, and the specs covering every file you touched.
7. Commit each fix on its own, with the commit prefix. Never rebase, reset or amend: the factory pushes without force.
8. Write the fix to the fix path: per failed check, the cause in one or two lines, what you changed (file and commit's short sha), and what you ran to check it and how it went. Mark any judgement call **Decision:**.

## Stop for Oscar instead

When the check fails on `origin/{{base}}` too, or it fails for a reason outside the code (an expired secret, a runner or network fault, a service CI depends on), or you can't make it pass without changing what the ticket asks for: commit nothing, and write to the fix path what fails, the evidence (the command and its output, on the branch and on `origin/{{base}}`), and what would fix it. The factory hands the ticket to Oscar.

## Finish line

- Either every failed check passes locally with your commits, and `git status` is clean; or nothing is committed and the fix file says why.
- The fix file is at the fix path.
