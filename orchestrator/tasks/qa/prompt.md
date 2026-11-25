This is a factory run of the `qa` task. The ticket below is a **QA scope**: a branch, an area, and the flows to walk in it. Walk every flow as a user or an API client would, hunt the release changes for suspects, and report each defect with evidence. Oscar decides what ships from what you post, so a defect needs proof and a pass needs evidence too. Nothing you change leaves the runner. Call each skill below with the Skill tool, in this order.

## Ticket {{identifier}}: {{title}}

{{url}}

{{description}}

## Release changes

They steer where you look, in the code hunt and in which flows you add; they never decide what you test. Every flow in the QA scope gets walked whether or not anything changed under it.

{{releaseChanges}}

## Known defects

Open bug tickets, and the defects earlier QA runs posted that no run has since found gone. Match against them by behaviour: the same steps and the same wrong result, never the code location, which moves between commits.

{{knownDefects}}

## Runner gaps

What production does that the runner can't. A flow stopped by one is **blocked**, never a defect.

{{runnerGaps}}

## Run values

- Every repo is under `~/bunny`, at `origin/{{base}}`, detached, and the stack runs that code. Nothing you commit leaves the runner.
- Evidence directory: `{{evidenceDir}}`
- Findings path: `{{findingsPath}}`
- Time limit: {{timeLimitMinutes}} minutes. Plan for it: a flow you don't reach is reported as not reached, which tells Oscar the QA scope was too big.

## Steps

1. `factory-rules`: the rules for the whole run. Your findings are the run's output, so the Decisions list and any Gaps go in them.
2. `factory-stack`: the repos, the running Bunny stack, and how to log in.
3. **Plan.** List the flows: the QA scope's own first, in its order, then any you add from the focus and the release changes. Each flow is one end-to-end path a user or an API client takes. A known defect in this area whose steps no flow covers gets a flow of its own: walking its steps is how you check it again.
4. **Start the code hunt** in the background. Start read-only subagents with the Agent tool, in parallel, over the release changes in this area: each reads a few of the changed files and returns suspects, each a possible defect with the steps that would show it. They never use the browser, the API or the database: there is one of each, and the walking is yours. Each suspect becomes an extra flow to try in the UI or the API, or with a spec.
5. **Walk every flow**, start to finish, creating the data it needs as you go.
   - **UI flows** in the browser, logged in as `factory-stack` says.
   - **API flows** as an external client. Create an API client with client credentials enabled (`bunny-stack run api bin/rails runner …`, or Settings → API Clients in the app), exchange its id and secret at `https://bunny.bunny.internal/oauth/token`, and call `/graphql` and `/api/...` with the bearer token. Reuse the token: issuance is limited to 12 a minute per client. Check what you get against the contract: `~/bunny/api/schema.graphql` and the developer docs in `~/bunny/docs-developer`. The dev-only `DevAuthAsUser` header is for seeding data only, never in an API flow.
   - Save evidence for every result in the evidence directory, under a name that says what it is:

     | Result | UI | API |
     |---|---|---|
     | Passed | End-state screenshot | Transcript of the key calls (`.txt`) |
     | Defect | Screenshot, or a video when it takes several steps | Transcript (request, status, response; secrets masked) or a failing request spec |
     | Blocked | The runner gap that blocked it | The runner gap that blocked it |

     Videos only for defects: one for every passing flow would eat the time. A failing spec is the best evidence, since it becomes the red test when the defect is fixed: write it under `~/bunny/api/spec/qa/`, copy it into the evidence directory, and delete it from `spec/` before you finish.
6. **Each failure:**
   - Reproduce it again from a fresh start, and count: `3/3`. A failure you can't reproduce is a suspect, not a defect.
   - Check it against the known defects. A match is not a new defect: record it with the known defect's reference.
   - A runner gap is never a defect: the flow is blocked.
   - A contract mismatch (the developer docs say one thing, the API does another) is a defect; say which side looks wrong.
   - Find where it is in the code, when you can: `repo/path:line`.
   - Give it a severity:

     | Severity | Meaning |
     |---|---|
     | **Blocker** | Don't ship: data loss, wrong money, a core flow broken, a security hole |
     | **High** | Ship only with a fix or a conscious waiver |
     | **Medium** | Real, with a workaround; fix soon |
     | **Low** | Cosmetic or rare |
7. **Each known defect whose steps you walked and that didn't reproduce:** record whether it looks **fixed** (name the release change that explains it) or simply **didn't reproduce** (nothing explains it, or its steps couldn't be followed as written).
8. **The suspects.** Try each one the code hunt returned. No evidence, no defect: a suspect that never reproduces goes in the suspects list with what you tried.
9. Write the findings to the findings path, in exactly this shape:

```markdown
## Coverage

| Flow | Result |
|---|---|
| <flow> | Passed / Defect <n> / Known <ref>, still reproduces / Blocked: <runner gap> / Not reached |

## Defects

### <n>. <title>

**Severity:** Blocker | High | Medium | Low · **Area:** <Area › Part> · **Known as:** <ref, or none>

**Steps**
1. …

**Expected:** …
**Actual:** …
**Evidence:** <file> · <file> (<what it shows>)
**Where:** <repo/path:line>, or not found
**Reproduced:** <n/m>
**Agent notes:** spec output, console errors, a network log excerpt

## Known defects checked again

- <ref>: still reproduces / fixed (<the release change>) / didn't reproduce (<why>)

## Suspects, not reproduced

- <suspect>: what you tried, and what happened

## Decisions

The calls you made with no human to ask, one line each, or `None.`
```

Add a `## Gaps` section at the end if the runner stopped you from checking something.

After you exit, the factory resumes this session and asks for the coverage, the defects and the suspects as structured output. It uploads your evidence, posts one comment per new defect and the coverage summary on this ticket, replies on each known defect you checked again, and the ticket waits on Oscar.

## Finish line

- The findings are at the findings path, in the shape above: every flow has a row, and every defect a section with its evidence in the evidence directory.
- No commits, and `git status` is clean in every repo: specs you wrote are copied to the evidence directory and deleted from `spec/`. Put throwaway scripts under `/tmp`.
