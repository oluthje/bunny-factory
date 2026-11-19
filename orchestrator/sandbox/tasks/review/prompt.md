This is a factory run of the `review` task: review the ticket's branch below, with no human present. Call each skill below with the Skill tool, in this order.

## Ticket {{identifier}}: {{title}}

{{url}}

{{description}}

## Run values

- Branch under review, already checked out in every repo: `{{branch}}`
- Review path: `{{reviewPath}}`
- Time limit: {{timeLimitMinutes}} minutes

## Steps

1. `oscar-factory-rules`: the rules for the whole run.
2. `code-review`, in each repo where `{{branch}}` differs from `origin/main`. The fixed point is `origin/main` and the spec is the ticket above.
3. Write one review, covering every changed repo, to the review path, in exactly this shape. The factory reads the two verdict headings, so write each once, with `PASS` or `CHANGES REQUESTED` and nothing else after the colon. An axis fails if any repo fails it.

```markdown
## Standards: PASS | CHANGES REQUESTED

One line of reasoning, then the findings, worst first, under a `### <repo>` heading per repo.
Give each finding its file and line (`path/to/file.rb:42`) when it has one, and cite the standard it breaks.

## Spec: PASS | CHANGES REQUESTED

One line of reasoning, then the findings, worst first, under a `### <repo>` heading per repo.
Quote the ticket line for each, and give its file and line when it has one.

## Decisions

The calls you made with no human to ask, one line each, or `None.`

## Rules this review wanted and could not find

Anything you wanted to fail the change for that no standard covers.
The retro reads this list.
```

Take the findings from the `code-review` report; don't merge or rerank them across the two axes. Replace the placeholder text in each section: in the last, one line per rule, naming the hunk that made you want it, or `None.`

After you exit, the factory resumes this session and asks for the findings that point at a line, to post as inline comments on the PR.

## Finish line

- The review is at the review path, in the shape above.
- You changed nothing: no edits, commits or pushes. `git status` is clean in every repo.
