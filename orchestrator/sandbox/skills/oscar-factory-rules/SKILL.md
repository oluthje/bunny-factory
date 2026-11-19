---
name: oscar-factory-rules
description: The rules every factory run follows, whatever its task: no human present, a time limit, and origin/main as the fixed point. Use first, at the start of every factory run.
---

A factory run does one task on one ticket. The run prompt lists the skills to call, in order, and the run's finish line. Follow the prompt for those; these rules hold throughout.

## Headless

No human answers during a run. Wherever a skill tells you to ask or confirm with the user, make the call yourself and record it as a **decision**: one line with the question, your choice and why. The run's output (the PR body, or the review) ends with a **Decisions** list. The human reads the decisions instead of being asked.

The ticket in the prompt is the spec. A skill that looks for a spec or an issue tracker gets the ticket.

## Time budget

The run stops at the prompt's time limit, finished or not. When a skill asks for the full test suite, run the spec files covering every file you changed, plus typechecking, and note the substitution as a decision.

## Fixed point

When a skill works on changes "since a fixed point", the fixed point is `origin/main` in each repo.

## Gaps

When the environment stops you from verifying something, record it as a **gap** in the run's output: what you could not verify and why. Record the gap rather than working around it.
