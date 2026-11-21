---
name: factory-deepen-grill
description: Decide a deepen candidate with Oscar: grill through it, then hand its ticket to implement or cancel it.
argument-hint: <ticket, such as REC-123>
disable-model-invocation: true
---

Decide one **candidate** with Oscar: the deepening on the Linear ticket `$ARGUMENTS`, which a `deepen-scan` run proposed and a `deepen-refute` run argued against. The session ends in one write to the ticket: a spec handed to `implement`, or a cancellation with Oscar's reason. Until Oscar says which, only read the ticket.

## 1. Load the candidate

With the Linear MCP tools, get the ticket and list its comments.

- The ticket carries the label `oscar-factory:candidate`. Without it, say so and stop.
- The refuter's **conclusion** is the latest comment whose first line contains `deepen-refute conclusion`. It links an HTML report: give Oscar the link. With no conclusion, tell Oscar the refuter hasn't finished and ask whether to go on without it.
- Oscar's own comments after the conclusion are his pushback so far.

Then read the code the candidate names. The Bunny repos sit beside this one (`../api`, `../app`, `../portal`, `../kong`), and their checkouts may be on other branches, so read `origin/main`: `git -C ../api fetch -q origin main`, then `git -C ../api show origin/main:<path>`.

Done when you can open with three sentences: what the candidate deepens, the refuter's verdict, and its strongest point against.

## 2. Grill

Call the Skill tool with `codebase-design` for the vocabulary. Then read `.claude/skills/improve-codebase-architecture/SKILL.md` (by path: the Skill tool won't load it) and run its step 3, the grilling loop, on this candidate. Here:

- Start the design tree from the refuter's Against and Cost: each point is a question for Oscar before the module's shape is.
- The glossary and ADRs that step updates belong to the Bunny repo the module lives in. `docs/glossary.md` here is the factory's.
- A rejection's reason goes on the ticket in step 3, where the next scan reads it. That replaces the ADR the skill offers for a rejected candidate.

Done when Oscar confirms the shared understanding and says go, no, or not now.

## 3. Write the decision

**Go.** The ticket's description becomes the spec an `implement` run builds from with nobody to ask. Draft it in this shape and show it to Oscar:

```markdown
## Goal

What gets deep and what that buys, in two or three sentences.

## The deepened module

Its interface as agreed: names and signatures, in the Bunny repo's glossary terms.

## Behind the seam

What moves inside, and what gets deleted.

## Callers

Each call site that changes, as `repo/path`, per repo. Name the order of the PRs when one repo's change needs another's.

## Tests

The specs written against the new interface, and the ones rewritten or deleted.

## Out of scope

What this change leaves alone.

## Decisions

Each call settled in the grilling, one line each.

+++ The original candidate

The ticket's description as the scan wrote it.

+++
```

The spec is ready when every question the grilling raised has its answer in it. On Oscar's yes, save the ticket with the Linear MCP `save_issue` tool: the new description, `addLabels: ["oscar-factory:implement"]`, `removeLabels: ["oscar-factory:human-needed"]`. The `oscar-factory:candidate` label stays on for good.

**No.** Post Oscar's reason as a comment, in his words and starting with them, then save the ticket with `state: "Canceled"` and `removeLabels: ["oscar-factory:human-needed"]`. The next scan reads his last comment on a cancelled candidate as the reason not to propose it again.

**Not now.** Write nothing. The ticket keeps waiting, and counts toward the three undecided candidates that hold the clock's scans back.

Reply with the ticket's URL and what was written.
