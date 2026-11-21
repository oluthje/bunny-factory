This is a factory run of the `deepen-scan` task: scan the Bunny codebase, with no human present, for **candidates**, deepenings that would turn shallow modules into deep ones. The factory files a ticket for each strong candidate, where a `deepen-refute` run argues against it before Oscar decides, so a candidate is only as good as its evidence. You change nothing. Call each skill below with the Skill tool, in this order, except where a step says to read a file by path.

## Ticket {{identifier}}: {{title}}

{{url}}

{{description}}

## Earlier candidates

What earlier scans proposed, and how each fared.

{{earlier}}

## Run values

- Every repo is under `~/bunny`, at `origin/{{base}}`, detached. Nothing you commit leaves the runner.
- Candidates path: `{{candidatesPath}}`
- Report path: `{{reportPath}}`
- Time limit: {{timeLimitMinutes}} minutes. The candidates file is the run's output and the report is its picture: write the file first.

## Steps

1. `factory-rules`: the rules for the whole run. The candidates file is the run's output, so the Decisions list and any Gaps go at its end.
2. `improve-codebase-architecture`: read `~/.claude/skills/improve-codebase-architecture/SKILL.md` and do its step 1, the exploring. You read it by path because the Skill tool won't load a skill marked `disable-model-invocation`. It calls `codebase-design` with the Skill tool for its vocabulary. In this run:
   - The ticket's description is the direction. When it gives none, the commit history of every repo picks the hot spots.
   - Propose what is new: a candidate that is not among the earlier ones above. One the refuter marked `not yet` comes back only when the condition it named now holds, and then its Problem says so.
   - A candidate may span repos, such as an `api` module and the `app` code that calls it.
   - Stop exploring when each candidate's Files all exist at `origin/{{base}}` and its Problem cites at least one `repo/path/to/file.rb:42` you opened.
3. Write the candidates file at the candidates path: one section per candidate, strongest first, in exactly this shape.

```markdown
## <the candidate: the module that gets deep, in the domain's words>

**Strength:** Strong | Worth exploring | Speculative

**Repos:** api, app

### Files

The files and modules involved, as `repo/path`.

### Problem

The friction today, with its evidence: `repo/path/to/file.rb:42`, and how often these files changed lately.

### Solution

In plain English, what would change. No interface yet: its shape is Oscar's to settle.

### Benefits

In terms of locality and leverage, and how the tests would improve.
```

   `Strong` means you would defend it against a refuter: the friction shows in recent commits, the module passes the deletion test, and the Problem's evidence is cited. Anything short of all three is `Worth exploring` or `Speculative`. Only the first {{candidateCap}} `Strong` candidates get a ticket, so their order is your ranking.

   End the file with `## Decisions` (the calls you made with no human to ask, one line each, or `None.`), and `## Gaps` if the runner stopped you from checking something.
4. Do the skill's step 2, the HTML report, from the candidates you wrote: same candidates, same order, same strengths. Write it to the report path. The run ends there: nobody is present to open the file or pick a candidate, and the skill's step 3, the grilling, is Oscar's to do later.

After you exit, the factory resumes this session and asks for the candidates as structured output. It files the tickets, posts your candidates on this ticket with the report attached, and closes it.

## Finish line

- The candidates file is at the candidates path, in the shape above, one `## ` section per candidate.
- The report is at the report path, with a card for every candidate in the file.
- You changed nothing: no commits, and `git status` is clean in every repo. Put throwaway scripts under `/tmp`.
