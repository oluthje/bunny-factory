This is a factory run of the `deepen-refute` task. The ticket below is a **candidate**: a deepening that a `deepen-scan` run proposed. You are its refuter: argue against it with no human present, weigh what survives, and recommend `do it`, `don't` or `not yet`. Oscar decides from your conclusion, so it has to be right about the code. You change nothing. Call each skill below with the Skill tool, in this order, except where a step says to read a file by path.

## Ticket {{identifier}}: {{title}}

{{url}}

{{description}}

{{thread}}

## Run values

- Every repo is under `~/bunny`, at `origin/{{base}}`, detached. Nothing you commit leaves the runner.
- Conclusion path: `{{conclusionPath}}`
- Report path: `{{reportPath}}`
- Time limit: {{timeLimitMinutes}} minutes. The Bunny stack isn't running: you read code and history, and may run a single spec file where a claim about tests turns on it.

## Steps

1. `factory-rules`: the rules for the whole run. The conclusion is the run's output, so the Decisions list and any Gaps go in it.
2. `codebase-design`: the vocabulary the candidate is written in (module, interface, depth, seam, adapter, leverage, locality) and the tests you hold it to. Use these terms in everything you write.
3. Read `{{runDir}}/method.md` and work through it. It is how a candidate is refuted, and it ends on the verdict.
4. Write the conclusion to the conclusion path, in exactly this shape. Oscar reads it on the ticket: keep it to about 30–50 lines, every number counted and every claim with its `repo/path/to/file.rb:42`.

```markdown
## Verdict: do it | don't | not yet

Two or three sentences Oscar can act on: the recommendation and the one reason that decides it. For `not yet`, the condition that would make it `do it`.

## Claims

Each claim the candidate makes about the code: holds, overstated or wrong, with its evidence.

## For

What survived your attacks, as locality and leverage: what gets easier, and for whom.

## Against

The attacks that landed, strongest first.

## Cost

The counts: files, call sites, specs rewritten or deleted, repos and PRs, and the door (one-way or two-way).

## Decisions

The calls you made with no human to ask, one line each, or `None.`
```

Add a `## Gaps` section at the end if the runner stopped you from checking something.

5. Write the report to the report path: one self-contained HTML page that lets Oscar understand the candidate and your case in two minutes. Read `~/.claude/skills/improve-codebase-architecture/HTML-REPORT.md` for the scaffold and the diagram patterns. You read it by path because the Skill tool won't load `improve-codebase-architecture`, and this file is the only part of that skill this run uses. Keep the page minimal, top to bottom:
   - the verdict as a badge, with the conclusion's opening sentences;
   - the candidate as one card: Files, Problem, Solution, and one before/after diagram;
   - For and Against side by side, each point one line;
   - the Cost as a row of numbers.

After you exit, the factory resumes this session and asks for the verdict as structured output. It posts the conclusion on the ticket with the report linked above it, and the ticket waits on Oscar.

## Finish line

- The conclusion is at the conclusion path, in the shape above, with the `## Verdict:` heading once.
- The report is at the report path and says the same verdict as the conclusion.
- You changed nothing: no commits, and `git status` is clean in every repo. Put throwaway scripts under `/tmp`.
