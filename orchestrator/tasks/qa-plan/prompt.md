This is a factory run of the `qa-plan` task. The ticket below asks for QA of a branch before it ships. Split it into **QA scopes**: bounded pieces of QA work, one product area each, that `qa` runs walk in parallel. You propose; Oscar accepts, changes or drops each one, and the factory files the ones he accepts. You read code and history only: the stack isn't running, and you change nothing. Call each skill below with the Skill tool, in this order.

## Ticket {{identifier}}: {{title}}

{{url}}

The focus, in Oscar's words. It always comes first.

{{description}}

{{thread}}

## Release changes

They decide where depth goes: which areas get QA scopes of their own, and which flows each one lists. They never decide what is tested: an area with no release changes still gets covered.

{{releaseChanges}}

## Known defects

Open bug tickets, and the defects earlier QA runs posted that no run has since found gone. A known defect in an area belongs in that QA scope's flows, so its `qa` run checks it again.

{{knownDefects}}

## Runner gaps

What production does that the runner can't. A flow that sits entirely behind one is not proposed: it goes under **Needs a human**.

{{runnerGaps}}

## Run values

- Every repo is under `~/bunny`, at `origin/{{base}}`, detached: `api` (Rails), `app` and `portal` (Vite), `kong`, `components`, `docs`, `docs-developer`, `skills-internal` and `integration-tests`. Nothing you commit leaves the runner.
- Proposals path: `{{proposalsPath}}`
- Time limit: {{timeLimitMinutes}} minutes.

## Steps

1. `factory-rules`: the rules for the whole run. The proposals are the run's output, so the Decisions list and any Gaps go in them.
2. **Map the product.** From the routes, the app's and the portal's pages, `api/schema.graphql` and `docs-developer`, list the product areas and the flows in each: one end-to-end path a user or an API client takes. Read the release changes against them: which areas they touch, and how deeply.
3. **Split by product area.** Each QA scope is one area, with every flow in it, so that every flow belongs to exactly one QA scope. Go deeper where the release changes are: more flows, or an area split in two. A QA scope should fit one 60-minute `qa` run: about 6–12 flows. Where a neighbouring flow belongs to another QA scope, say which, under **Owned by another QA scope**: that keeps parallel runs off the same ground.
4. **Leave out what only a runner gap would test.** List it under **Needs a human** instead.
5. **A later run:** start from the earlier proposals and Oscar's replies above. Revise what he asked of the QA scopes not filed yet, and nothing else. Mark accepted every QA scope he accepted, now or before; leave out the ones he dropped. Keep the filed ones as they are.
6. Write the proposals to the proposals path, a section per QA scope in number order, each in exactly this shape:

```markdown
## <number>. QA: <Area> · proposed | accepted

**Branch:** {{base}}
**Area:** <Area>
**Interface:** UI | API | UI and API

**Flows**
1. <flow>

**Release changes in this area**
- api#1234 "Prorate on plan change" (REC-88)

**Owned by another QA scope**
- <flows> → <number>. QA: <Area>
```

Then:

```markdown
## Needs a human

- <flow>: <the runner gap that stops it>

## Decisions

The calls you made with no human to ask, one line each, or `None.`
```

After you exit, the factory resumes this session and asks for the QA scopes as structured output. It files each accepted QA scope not filed yet as a sub-ticket labelled `oscar-factory:qa`, which starts its run, posts the proposals as one comment, and the ticket waits on Oscar.

## Finish line

- The proposals are at the proposals path, in the shape above: every flow in exactly one QA scope, and nothing accepted that Oscar didn't accept.
- You changed nothing: no commits, and `git status` is clean in every repo. Put throwaway scripts under `/tmp`.
