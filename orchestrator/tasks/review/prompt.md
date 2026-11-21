This is a factory run of the `review` task: review the ticket's branch below with no human present, fix what you're sure of, and leave the rest for Oscar. Call each skill below with the Skill tool, in this order.

## Ticket {{identifier}}: {{title}}

{{url}}

{{description}}

{{prContext}}

## Run values

- Branch under review, already checked out in every repo: `{{branch}}`
- Commit prefix: `{{identifier}}: `
- Review path: `{{reviewPath}}`
- Time limit: {{timeLimitMinutes}} minutes

## Steps

1. `factory-rules`: the rules for the whole run.
2. `factory-stack`: the repos and the running Bunny stack, for running specs. There is no browser in this run.
3. `code-review`, in each repo where `{{branch}}` differs from `origin/{{base}}`. The fixed point is `origin/{{base}}` and the spec is the ticket above, read with the PR body's Decisions.
4. Fix the findings you're sure of. A finding is yours to fix when it has one clear fix that Oscar would plainly accept: a broken standard, a missed edge case, a small slip from the spec. Commit each fix on its own, with a spec where one fits, and run the specs covering the files you touched.
   Leave a finding as a comment when it needs a product decision, has more than one sensible fix, or you aren't sure. Start a product call's finding with **Decision needed:**, and give it two to four options: at least two real ways to do it, plus leaving it as it is where that's a choice. Give each option what the user sees, what it costs, and your pick.
5. Write one review, covering every changed repo, to the review path, in exactly this shape. The factory reads the two verdict headings, so write each once, with `PASS` or `CHANGES REQUESTED` and nothing else after the colon. The verdicts judge the branch **after** your fixes. An axis fails if any repo fails it.

```markdown
## Fixed

One line per fix you committed: the finding, the commit's short sha, and its file and line. `None.` if you fixed nothing.

## Standards: PASS | CHANGES REQUESTED

One line of reasoning, then the findings you left, worst first, under a `### <repo>` heading per repo.
Give each finding its file and line (`path/to/file.rb:42`) when it has one, and cite the standard it breaks.

## Spec: PASS | CHANGES REQUESTED

One line of reasoning, then the findings you left, worst first, under a `### <repo>` heading per repo.
Quote the ticket line for each, and give its file and line when it has one.

## Decisions

The calls you made with no human to ask, one line each, or `None.`

## Rules this review wanted and could not find

Anything you wanted to fail the change for that no standard covers.
The retro reads this list.
```

Take the findings from the `code-review` report; don't merge or rerank them across the two axes. Replace the placeholder text in each section: in the last, one line per rule, naming the hunk that made you want it, or `None.`

After you exit, the factory resumes this session and asks for the findings you left that point at a line, to post as inline comments on the PR, and for each **Decision needed:** finding as a question card. Then it pushes your fixes and marks the PRs ready for review.

## Finish line

- The review is at the review path, in the shape above.
- Every fix is committed on the branch in its repo, each message starting with the commit prefix. `git status` is clean in every repo.
- The branch only gains commits: no rebase, amend, reset or squash, and no push. The factory pushes.
