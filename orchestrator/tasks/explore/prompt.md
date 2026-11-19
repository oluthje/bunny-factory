This is a factory run of the `explore` task: check the ticket below against the code, with no human present, and write findings. They let Oscar decide in thirty seconds whether to build it, and give the implementer a head start. You change nothing. Call each skill below with the Skill tool, in this order.

## Ticket {{identifier}}: {{title}}

{{url}}

{{description}}

{{thread}}

## Run values

- Every repo is at `origin/main`, detached. Nothing you commit leaves the runner.
- Evidence directory: `{{evidenceDir}}`
- Findings path: `{{findingsPath}}`
- Time limit: {{timeLimitMinutes}} minutes. Exploring is the cheap run before implement: aim to finish well inside it.

## Steps

1. `oscar-factory-rules`: the rules for the whole run. Your findings are the run's output, so the Decisions list and any Gaps go in them.
2. `oscar-factory-stack`: the repos and the running Bunny stack.
3. List the ticket's claims: what it says is true now (a bug, a missing piece, a behaviour) and what it asks for.
4. Check each claim against the code, and against the running stack where that's cheap: a `bunny-stack run api bin/rails runner` one-liner, or a spec. Give every claim its evidence: `repo/path/to/file.rb:42`, a reproduction's output, or a screenshot. Use the browser only for claims about the UI: open the page and save a screenshot to `{{evidenceDir}}/<name>.png`. Never trust the ticket's wording over the code.
5. Map the change: the 2–3 places it would touch, across repos (models, services, routes, components, tables). Find out whether it needs a schema change or a migration, and whether it's a one-way door (a migration that drops or rewrites data, a public API, a customer-facing email, a name that ends up in stored data) or a two-way door.
6. Give the verdict:
   - `easy-call`: the claims hold up, the right change is clear, nobody would disagree with any decision in it, and it's a two-way door. You'd be happy for the PR to land without Oscar weighing in first. It goes straight to implement.
   - `human-needed`: anything else. Something needs deciding first (a migration, a name, a policy, a trade-off), a claim didn't hold up, or the ticket is unclear. A one-way door is always `human-needed`. If you find yourself weighing it up, that weighing is the answer.
7. Write the findings to the findings path, in exactly this shape. Oscar reads them on the ticket, and the implementer gets them as context, so keep them to about 20–40 lines.

```markdown
## Verdict: easy-call | human-needed

One line: why.

## Claims

Each claim, whether it holds up, and its evidence. A screenshot goes in as `![what it shows]({{evidenceDir}}/<name>.png)`.

## Blast radius

In prose, the 2–3 places the change touches. A schema change or a migration goes first, in bold.

## Door

One-way or two-way, and why.

## Open questions

What Oscar has to settle before it's built, each with your recommended answer. `None.` only on an easy call.

## Decisions

The calls you made with no human to ask, one line each, or `None.`
```

Add a `## Gaps` section at the end if the runner stopped you from checking something.

After you exit, the factory resumes this session and asks for the verdict. It posts the findings on the ticket, and on an easy call it queues `implement`.

## Finish line

- The findings are at the findings path, in the shape above, with the `## Verdict:` heading once.
- You changed nothing: no commits, and `git status` is clean in every repo. Put throwaway reproductions under `/tmp`, or delete them before you finish.
