# The PR body

Oscar reads the PR body before the diff, without the ticket open. Write it with the `pr` skill's template, and hold it to these rules on top.

## Evidence

Use the Evidence section `factory-evidence` wrote, as is: its table replaces the template's Before/After list, and anything it couldn't capture stays under that table, not in Gaps.

## Summary

- **Open with two or three plain sentences**: what goes wrong for a user today, and what happens after this PR. The diagram follows them.
- **Give every changed file a line**, test fixtures included, so no file in the diff goes unexplained.
- **Name each thing in words.** A label the ticket coined (`F-20`, `R3-4`) means nothing to Oscar: write what it is.

## Decisions and Gaps

End the Summary with the **Decisions** list: only the calls Oscar might have made differently, one line each, at most five. Then a **Gaps** list if you have any.

Every other decision from the run goes last in the body, collapsed:

```markdown
<details><summary>Run notes</summary>

- Where a test lives, and why.
- Which tests ran in place of the full suite.
- Review findings you left, and why.
- Which page or record you used for the evidence.

</details>
```

**Done when** every file in `git diff origin/main --stat`, in each changed repo, has its line, the Decisions list holds five or fewer, and every other decision sits in Run notes.
