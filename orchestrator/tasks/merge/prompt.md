This is a factory run of the `merge` task: decide, with no human present, whether the ticket's open PRs below are an easy call to merge with nobody looking. You change nothing: the factory merges, after its own checks, only if you clear every PR. Call each skill below with the Skill tool, in this order.

## Ticket {{identifier}}: {{title}}

{{url}}

{{description}}

{{thread}}

## Open PRs

Each with its CI, which has finished and is green, its body, the factory review and anything else said on it.

{{prs}}

## Run values

- Branch, already checked out in every repo with a PR: `{{branch}}`
- Verdict path: `{{verdictPath}}`
- Time limit: {{timeLimitMinutes}} minutes. Reading is all this run does: aim to finish well inside it.

## Steps

1. `factory-rules`: the rules for the whole run. The verdict is the run's output: its reasons stand in for the Decisions list.
2. Read the rubric at `{{runDir}}/rubric.md`. It is what "easy call" means here.
3. In each repo with a PR, read the whole diff, `git diff origin/{{base}}...HEAD`, and the code around it where a hunk's effect isn't plain from the hunk. Check the diff against the ticket, as Oscar's comments refine it: it does what the ticket asks, and nothing else.
4. Read the factory review and the threads as evidence, not as the verdict. A finding it left that you judge minor doesn't hold a PR back; say why. A **Decision needed:** finding nobody has answered always does.
5. Judge each PR: `merge` or `human-needed`, by the rubric. The ticket's PRs merge together or not at all, so judge them as one change too: a PR that only works with another (an app reading an api field) is judged with it. If you find yourself weighing it up, that weighing is the answer: `human-needed`.
6. Write the verdict to the verdict path, in exactly this shape:

```markdown
## Verdict: merge | human-needed

One line: the verdict for the ticket as a whole, and why.

## <repo>: merge | human-needed

Two or three lines: what the PR does, and the rubric's reasons for the verdict. One section per PR.

## Order

The order to merge in, when it matters, and why: such as the api first because the app reads its new field. `Default.` otherwise.
```

After you exit, the factory resumes this session and asks for the verdict as structured output. Then it checks, on its own, that every PR is still open, green, conflict-free, not into `production`, and unchanged since you read it, and merges them all, or none.

## Finish line

- The verdict is at the verdict path, in the shape above, with one section per PR.
- You changed nothing: no commits, and `git status` is clean in every repo.
