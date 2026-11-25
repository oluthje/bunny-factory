# QA tasks: design

Agreed 2026-11-25; nothing is built yet. Two new tasks, `qa-plan` and `qa`, find defects in a branch before it ships and end in a QA verdict: go, go with caveats or no-go. Terms are in [glossary.md](glossary.md) once the entries under [Glossary](#glossary) are added.

## The shape

```
Oscar files a ticket: oscar-factory:qa-plan
  "Branch: release/2026-11-25. Focus: billing, portal checkout, the subscriptions API."
        │
        ▼
qa-plan run ── proposes QA scopes in one comment, each numbered and folded ──▶ waits on Oscar
        │
        │  Oscar replies ("Accept 1, 2, 4. Drop 3. For 2 also cover coupon stacking")
        │  and puts oscar-factory:qa-plan back on the ticket
        ▼
qa-plan run ── revises what Oscar asked; files each accepted QA scope as a sub-ticket
        │      already labelled oscar-factory:qa; the rest stay proposals
        ▼
qa runs, in parallel up to FACTORY_MAX_RUNS, one per QA scope
  each posts a coverage summary and one comment per defect on its own sub-ticket
        │
        ▼
QA verdict ── a sweep posts it on the qa-plan ticket once every filed QA scope has finished
```

Oscar does the partitioning: `qa-plan` proposes, he accepts, edits or drops. He can also file a `qa` ticket by hand with a QA scope in its description, skipping `qa-plan`.

## Inputs to both tasks

- **Branch.** A `**Branch:** <name>` line in the ticket's description; `main` when absent. `qa-plan` copies it into every QA scope it files. A release candidate is a branch like any other.
- **Focus.** The rest of the description, in Oscar's words. It always comes first.
- **Release changes.** `prepare` computes `production..<branch>` in every repo: commits, PRs and their linked tickets. It steers attention (which areas get QA scopes, where the code hunt starts), never what is tested. An empty diff, as on `production` itself, means a whole-area run.
- **Known defects.** `prepare` gathers open bug tickets and the defects earlier QA runs posted, each with its Steps, Expected and Actual, and a reference: `REC-201 #4` for defect 4 on REC-201, or the bug ticket's id. See [Duplicates](#duplicates).
- **Runner gaps.** Both prompts carry the list (below), filled from `factory-stack`'s "Runner gaps" section by a placeholder so it lives in one place.

## `qa-plan`

- `branch: "none"` on the named branch, no stack, no browser, 30 minutes. It reads code and the release changes.
- **Partitions by product area**, using the release changes to decide where depth goes. Every flow belongs to exactly one QA scope.
- **Leaves out what only a runner gap would test.** A flow that sits entirely behind one is not proposed; it goes in the comment's **Needs a human** section, which the QA verdict repeats.
- **First run:** posts the proposals and waits on Oscar (`next: "human"`).
- **A later run:** reads Oscar's reply to the last proposals. Its structured pass returns the accepted QA scopes; the orchestrator files each as a sub-ticket of the `qa-plan` ticket, labelled `oscar-factory:qa`. QA scopes Oscar didn't mention stay proposals. The comment lists the filed QA scopes first, a linked line each, then the ones still proposed. While any is still proposed the run waits on Oscar; once none is, it ends `next: "done"`. The loop cap (5 runs) bounds the back-and-forth.

A QA scope's description, proposed or filed:

```markdown
**Branch:** release/2026-11-25
**Area:** Portal checkout
**Interface:** UI and API

**Flows**
1. Guest checkout with card, single plan
2. Checkout with coupon, then plan change
3. Create a subscription via the API, then fetch its invoice

**Release changes in this area**
- api#1234 "Prorate on plan change" (REC-88)

**Owned by another QA scope**
- Invoice PDFs, refunds → QA: Billing (REC-201)
- Admin settings → QA: Settings (REC-202)
```

"Owned by another QA scope" is what keeps parallel runs from covering the same ground: overlaps show while Oscar reviews the proposals, not later as duplicate defects.

## `qa`

- `branch: "none"` on the QA scope's branch, with the stack and the browser, 60 minutes. Nothing is pushed.
- **Job 1, end to end: walk every flow in the QA scope**, as the user or API client would, creating the data each flow needs. This is the main job.
  - **UI flows** in the browser.
  - **API flows** as an external client: create an API client with client credentials enabled (`bin/rails runner`, or Settings → API Clients in the app), exchange its id and secret at `https://bunny.bunny.internal/oauth/token`, call `/graphql` and `/api/...` with the bearer token. Reuse the token: issuance is limited to 12 a minute per client. Check behaviour against the contract: `api/schema.graphql` and the developer docs in `~/bunny/docs-developer`. The dev-only `DevAuthAsUser` header is for seeding data only, never in an API flow.
- **Job 2, the code hunt.** Read-only subagents go through the release changes in the area for suspects, in parallel. Each suspect becomes an extra flow to try in the UI or the API, or with a spec. UI and API work stays in the main agent: there is one browser and one database.
- **No evidence, no defect.** A suspect that never reproduces goes in the summary's folded **Suspects, not reproduced** list, not in a comment of its own.
- **Runner gaps are never defects.** A flow stopped by one is blocked.
- **Known defects are matched, not reported again.** See [Duplicates](#duplicates).
- Ends waiting on Oscar (`next: "human"`).

### What a `qa` run posts

The runner never holds the Linear key: the run writes its evidence files and a findings file, the structured pass returns `{ flows, defects }` (zod-checked, retried up to 2 times), and the orchestrator uploads the evidence (`src/evidence.ts`) and posts.

**The coverage summary**, one comment: a row per flow, every result linked to its evidence, the passing evidence folded.

| Flow | Result |
|---|---|
| Guest checkout, card | ✅ Passed |
| Coupon then plan change | ❌ QA-4 (links to the defect's comment) |
| Refund a paid invoice | ❌ Known: REC-201 #4, still reproduces |
| Pay with a third-party gateway | ⛔ Blocked: third-party APIs unreachable |
| ... | ⏭ Not reached (time) |

The commits tested go under the table, one SHA per repo. "Not reached" keeps a short run honest, and tells `qa-plan` its QA scopes are too big.

**One comment per defect:**

```markdown
**QA-4 · High · Invoices › Refunds**
Refunding a paid invoice twice creates two credit notes

**Steps**
1. Log in as the seeded admin, open invoice INV-0012 (paid)
2. Click Refund, confirm; click Refund again before the modal closes

**Expected:** one credit note, second click ignored
**Actual:** two credit notes for the full amount

**Evidence:** double-refund.webm · refund_twice_spec.rb (fails: expected 1, got 2)
**Where:** api/app/services/refund_invoice.rb:41, app/src/invoices/RefundModal.tsx:88
**Reproduced:** 3/3

+++ Agent notes
spec output, console errors, network log excerpt
+++
```

A contract mismatch (the developer docs say one thing, the API does another) is a defect; it says which side looks wrong.

### Evidence

| Result | UI | API |
|---|---|---|
| ✅ Passed | End-state screenshot | Transcript of the key calls |
| ❌ Defect | Screenshot, or a video when it takes several steps | Transcript (request, status, response; secrets masked) or a failing request spec |
| ⛔ Blocked | The runner gap that blocked it | The runner gap that blocked it |

Videos only for defects: one for every passing flow would eat the time budget. A failing spec is the best evidence: it becomes the red test when the defect is fixed.

### Duplicates

- **Matched by behaviour.** The agent compares each defect with the known defects: the same steps and the same wrong result. Never by code location, which moves between commits.
- **A match is a reply, not a new comment.** The structured pass returns `knownAs: "REC-201 #4"`; the orchestrator replies in that defect's thread (or on the bug ticket) with "Still reproduces on `<sha>`" and the fresh evidence. The coverage row reads ❌ Known: REC-201 #4.
- **A known defect whose flow now passes** gets a "No longer reproduces on `<sha>`" reply, with its passing evidence.
- **Between parallel QA scopes**, which can't see each other, Oscar marks the rare duplicate with a reply in its thread, `Duplicate of REC-201 #4`. The QA verdict counts the pair once, at the higher severity of the two after regrades.

### Severity

| Severity | Meaning |
|---|---|
| **Blocker** | Don't ship: data loss, wrong money, a core flow broken, a security hole |
| **High** | Ship only with a fix or a conscious waiver |
| **Medium** | Real, with a workaround; fix soon |
| **Low** | Cosmetic or rare |

## The QA verdict

A sweep (the pattern of `bulk-batches`) notices when every filed QA scope of a `qa-plan` ticket has finished, and posts the QA verdict there:

- **The verdict, by rule, not by an agent:** no-go on any Blocker; go with caveats on any High; otherwise go. Oscar overrules it by regrading a defect: a reply in the defect comment's thread, `Regrade: <severity>`, with the reason after it. The sweep reads the latest regrade in each thread, Oscar's only, in place of the run's severity. A regrade after the QA verdict is posted makes the sweep post it again.
- A table per QA scope: passed, defects by severity, blocked, not reached.
- The commits tested.
- **Needs a human:** what `qa-plan` left out and every blocked flow.

## Runner gaps

What production does that the runner can't. Both prompts carry this list; a flow stopped by one is blocked.

- The login, widget, metabase and admin routes return 502: those services aren't in the stack. Login itself works: it lives in app at `/app/login`.
- Third-party APIs are unreachable.
- No GitHub or Linear access.
- **Gateway rate limits.** Production Kong limits `/graphql` per token; Caddy doesn't. Rails' own limits (token issuance, `/oauth/register`) do run.
- **Gateway behaviour we can't see.** The production Kong config lives in a `kubernetes-infrastructure` repo; `kong/kong-production.yml` is from 2022. Request size limits, allowlists and any other plugins are unknown.
- **Other hosts.** Only `bunny.bunny.internal` resolves, so behaviour across warrens and on the generic `auth` host is limited.

Auth is not a gap: Rails validates tokens, not Kong, and Caddy routes `/oauth`, `/graphql`, `/api` and `/.well-known/oauth-*` as Kong does.

## Engine changes

Each is a hook or fix any task can use, in its own commit (see [coding-standards.md](coding-standards.md)).

1. **Choosing the branch.** Today `branch: "none"` means `origin/<base>`, and the base is `main` or a bulk branch. Add a way for `prepare` to set the run's base from the ticket. Merging stays impossible: `production` is in `PROTECTED_BASES`, and `qa` never pushes.
2. **Rebuilding databases that are ahead of the code.** The snapshot's databases are migrated to a recent `main`, and catch-up only runs `db:migrate`, which never undoes a migration. On a branch behind `main` (`production`, a release candidate, an old feature branch) the code runs against a newer schema: false defects, or real ones hidden. In `bunny-stack up`, before services start:
   - **The check**, for each of api's three databases (`primary`, `events`, `queue`, each with its own `db/migrate/<db>` and schema file) and their test copies: a version in `schema_migrations` with no file in the branch's migrations folder, ignoring versions older than the folder's oldest file (so a squash doesn't trigger it).
   - **The rebuild**, when any is ahead: development `db:drop`, then `bunny-stack setup`'s fresh path (`db:setup db:migrate`, the CORS whitelist); test `RAILS_ENV=test db:drop db:prepare`.
   - **A line in `catch-up.log`** naming each database that was ahead and by which versions.
   - A few minutes, only on runs that need it. Every task gets it; it fixes stale `implement` updates too. It needs a snapshot rebuild. A second warm snapshot built from `production` is the fallback if QA on `production` becomes frequent.
3. **The snapshot check against the run's branch.** The pre-run check compares the snapshot with `main`'s Ruby, Node and private gem versions; it must compare with the run's branch. `production` already differs: api#7409 put Ruby 3.4.13 there as a hotfix.
4. **The QA verdict sweep**, unless a hook for "every sub-ticket of a ticket finished" already fits.

## Glossary

Add a **QA** section after _Tasks and runs_, and `qa-plan` and `qa` to the task list in _Task_. Rename `factory-stack`'s "Known gaps" to "Runner gaps".

**QA scope**:
One bounded piece of QA work: a branch, an area, its flows, the release changes in it, and what other QA scopes own. Proposed in a `qa-plan` comment and, once Oscar accepts it, filed as a `qa` sub-ticket.
_Avoid_: charter, slice, area, partition, test plan, plain "scope" (API clients have OAuth scopes)

**Flow**:
One end-to-end path a user or an API client takes, walked start to finish. Each flow gets one row in the coverage table.
_Avoid_: test case, scenario, journey, path, use case

**Suspect**:
A possible defect, from the code hunt or a hunch, not yet reproduced. It becomes a defect only with evidence.
_Avoid_: lead, hunch, potential bug, possible defect

**Defect**:
A reproduced failure of a flow, or a place where the UI or API breaks its documented contract, with evidence and a severity.
_Avoid_: bug, issue, finding, problem

**Runner gap**:
Something production does that the runner can't, such as calling a third-party API. A flow stopped by one is **blocked**, never a defect.
_Avoid_: known gap, limitation, unsupported

**QA verdict**:
The comment on a `qa-plan` ticket once every filed QA scope has finished: go, go with caveats or no-go, set by rule from the defects' severities.
_Avoid_: rollup, sign-off, approval, release verdict


## Build order

1. The engine changes 1–3: useful on their own, and `qa` gives false defects without 2.
2. `qa`, filed by hand: a QA scope in the description. That alone makes parallel QA possible.
3. `qa-plan`: proposals, then filing accepted QA scopes.
4. The QA verdict sweep.
