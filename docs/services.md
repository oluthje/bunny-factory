# Bunny factory: services

The services half of the Bunny software factory design, agreed 2026-11-18. Tasks are designed separately and are not covered here.

Terms follow the `software-factory` skill: ticket tracker, ticket source, git host, orchestrator, runner, run, task, trigger, observability platform.

## Slots

| Slot                   | Choice                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| Ticket tracker         | Linear, workspace `bunnyinc`, team `REC`                                                           |
| Ticket source          | Deferred. Oscar adding an `oscar-factory:<task>` label is the only source for now                         |
| Git host               | GitHub, `bunnyapp/{api,app,portal,kong,components,docs,docs-developer}`                            |
| Orchestrator           | Inngest Cloud. Function code on Fly.io: one Node service, one machine. State in SQLite on a Fly volume, via Drizzle |
| Runner                 | Daytona: a native, no-Docker warm snapshot built from `runner/` in this repo. One ephemeral sandbox per run |
| Harness                | Headless Claude Code (`claude -p`) with Playwright MCP                                             |
| Observability platform | None yet: the Inngest dashboard, run artifacts on the Fly volume, screenshots on the Linear ticket  |

## Decisions and why

1. **Leave GitHub Actions for both orchestrator and runner.** Throttles, loop caps and a record of run states are awkward in workflow YAML.
2. **Inngest as orchestrator.** Long waits cost nothing, concurrency and throttle keys are built in, and it comes with a dashboard. LangChain and LangGraph were rejected: they are for writing an agent loop, and an off-the-shelf harness already does that inside the runner.
3. **Fly.io hosts the Inngest functions.** Vercel Hobby forbids commercial use. Fly also leaves room for SQLite, Inngest Connect and a small dashboard on the same app. The host only coordinates; all heavy work happens in Daytona.
4. **The runner runs the Bunny stack without Docker.** Each service runs natively: Rails, Solid Queue, Vite ×2, Postgres 18, Redis, maildev, and Caddy in place of Kong. Docker-in-Docker costs at least 2 vCPU / 4 GiB of overhead, starts with a cold image cache, and has cgroup issues.
5. **Headless Claude Code** reads `CLAUDE.md` and the repo skills, and drives the in-sandbox Chromium via Playwright MCP.
6. **The model is accessed with your personal Claude subscription token** (`claude setup-token`). It is chosen for cost. Consequences:
   - runs share your subscription's usage limits, so concurrency is capped low: 3 runs by default (`FACTORY_MAX_RUNS`), well under what Daytona's tier 2 allows (about 25 runners at 4 vCPU / 8 GiB)
   - the token expires, so you need to renew it
   - it must never be baked into the snapshot
7. **GitHub access uses your existing fine-grained PAT, held only on Fly.**
   - A PAT cannot create short-lived tokens, and a GitHub App needs company approval.
   - Code enters and leaves sandboxes as git bundles over Daytona's file API, so **the sandbox never holds a GitHub credential**.
   - PRs are authored by you, so a teammate must do the human review.
   - The `merge` task merges as you too. No repo requires an approving review on `main`, so that works today. It needs the PAT to read checks and commit statuses as well as write contents and pull requests.
   - The PAT **expires 2026-12-17**, and Fly warns a week ahead.
8. **GitHub events are polled.** You don't have admin rights on `api` or `kong`, so you can't add webhooks there.
   - An Inngest cron runs every 2–5 minutes and emits events such as `github/pr.review_submitted`.
   - GitHub-triggered runs stay switched off until Linear-triggered runs have earned trust.
9. **Linear events are polled.** You are not a workspace admin, so you can't add webhooks.
   - An Inngest cron runs every 1–2 minutes on `updatedAt` cursors.
   - A ticket opts in only when it has an **`oscar-factory:<task>` label** (`oscar-factory:implement`, `oscar-factory:review`, `oscar-factory:explore` or `oscar-factory:merge`) and is **assigned to Oscar** (the owner of `LINEAR_API_KEY`). Every Linear name the factory creates (labels, comment markers) is prefixed `oscar-`, since the factory is personal.
   - **The labels are the ticket's state**, and `orchestrator/src/transitions.ts` is the one place that changes them:
     - **Pickup.** The poller adds **`oscar-factory:in-progress`** and leaves the task label on, so Linear shows which stage each ticket is in. While the run works, the poller doesn't start another on the ticket.
     - **A run ends.** The factory removes in-progress and the task label. It then either adds the next task's label from the chain, or adds **`oscar-factory:human-needed`** so the tickets waiting on Oscar are one filter away. The chain: an `explore` run with an easy-call verdict hands off to `oscar-factory:implement`, an `implement` run that pushed commits hands off to `oscar-factory:review`, and a `review` run that posted on a PR hands off to `oscar-factory:merge`. A `merge` run that merged ends the chain with no factory label at all.
     - **The poller is the only thing that starts runs.** A ticket with a run queued or working waits, and the run's end brings it back.
     - **At most `FACTORY_MAX_RUNS` runs in flight (default 3), held by the poller.** Each poll fills the free slots, oldest ticket first; the rest keep their task label and wait in Linear. A ticket still has one run at a time. Inngest's concurrency limit can't do this: it counts only executing steps, and a run's `step.sleep` waits free the slot. Runs share the orchestrator's git mirrors, so each repo's mirror takes one operation at a time.
     - **Loop cap:** 5 runs of one task per ticket. Past it, the poller refuses the run and the ticket waits on Oscar.
     - The poller ignores in-progress and human-needed when choosing a task, and the flag label **`oscar-factory:no-auto-merge`**, which only Oscar sets: the factory never merges that ticket's PRs.
   - Every factory comment carries a marker, so the pollers skip the factory's own comments.
10. **The factory's state lives in SQLite on a Fly volume**, with one machine. It holds:
    - the poll cursors and last-seen PR state
    - links from ticket to branch to PR to runs, for loop caps
    - snapshot metadata
    - run records
11. **One ephemeral sandbox per run.** Auto-stop is off, because background processes don't reset it. The run deletes the sandbox however it ends, which also keeps Tier 1 disk quota free. As a backstop, each sandbox gets a Daytona wall-clock TTL: Claude's time limit plus the run's other steps. When the TTL runs out, Daytona destroys the sandbox even if the orchestrator has lost the run.
12. **Fly learns that a run has finished by polling Daytona** every 30–60 seconds. The sandbox holds no credential for any factory service.
13. **The Claude token goes in as a Daytona Secret.** The sandbox sees only a placeholder, which Daytona's proxy swaps for the real token on HTTPS requests to Anthropic.
14. **The warm snapshot is built by a script on your Mac**, passing the PAT as a build-time secret, then pushed to Daytona. You rebuild it when Fly says to (see below). Automate the build later with an Inngest-triggered builder sandbox.
15. **No observability platform yet.** Fly copies artifacts out of each run (see below). Langfuse, self-hosted on Fly, is the natural next step.
16. **Ticket sources are deferred** to the tasks session.

## A run's lifecycle

1. Fly checks the snapshot is still valid: the same Ruby and Node versions and private gem versions as the target `main`. On a mismatch, the run doesn't start and you're told to rebuild.
2. Fly creates the sandbox from the warm snapshot, with auto-stop off, a wall-clock TTL, and the Claude token as a Daytona Secret.
3. Fly uploads a git bundle of the base or PR branch.
4. The sandbox catches up and starts the stack: `bundle install`, `npm install` (not `npm ci`), `db:migrate`, then `bunny-stack up`.
5. Fly starts `claude -p …` in a background Daytona session.
6. Fly polls Daytona every 30–60 seconds until the session exits or the hard timeout passes.
7. Fly collects artifacts. This happens on success, failure and timeout:
   - the Claude transcript (`~/.claude/projects/*.jsonl`)
   - the stack logs
   - Playwright screenshots and traces
   - a git bundle of the new commits
8. Fly pushes the branch and opens or updates the PR as you, then posts a marked comment with screenshots to Linear.
9. Fly deletes the sandbox.

The **`sweep-runs` cron** (every 5 minutes) cleans up after runs Inngest has lost, for example when the Inngest dev server restarts mid-run, which drops its in-memory state. A lost run never reaches its own cleanup, so it would hold one of the poller's `FACTORY_MAX_RUNS` slots forever.
- Every call Inngest makes to a run records a heartbeat on the run's row. If a run in flight has no heartbeat for 30 minutes, the sweeper deletes its sandbox and closes the run as failed, and the ticket goes to `oscar-factory:human-needed`.
- It also deletes any factory sandbox whose run has finished. It leaves alone sandboxes of runs it doesn't know, since another orchestrator may share the Daytona account.
- It doesn't collect artifacts from these sandboxes.
- It prunes run folders on the volume (see _Observability and retention_), and keeps running while the factory is stopped.

**Starting and stopping.** A `factory_state` row in SQLite says whether the factory takes new runs; `factory stop` and `factory start` set it (the root `README.md` documents the CLI). The poller checks it every tick, and each run checks it again just before creating its sandbox. A machine starts runs only when the state allows it and its `FACTORY_POLL` secret is `on`, which only Fly has. A run the factory stops itself, by draining or by `stop --now`, ends `cancelled`, keeps its task label, and doesn't count toward the loop cap.

**Deploys.** Every push to `main` runs the checks and deploys to Fly with GitHub Actions, then resyncs Inngest Cloud. A deploy goes out with runs in flight, and Inngest retries the step the restart cut off, so every step of a run is safe to run twice.

## Warm snapshot

**Contents:**
- the seven repos at a recent `main`. `components`, `docs` and `docs-developer` are only cloned: nothing is installed for them
- gems, including the private ones
- `node_modules` for `app` and `portal`
- all three databases (`bunny_development`, `bunny_events`, `bunny_queue`), migrated and seeded with the CORS whitelist applied
- Playwright Chromium, with the Bunny cert trusted

**Rebuild policy:**
- **Must rebuild:** `.ruby-version`, the Node version, a private gem version or the Postgres major version changes. These block the run.
- **Should rebuild:** catch-up takes over about 3 minutes, or the snapshot is more than 7 days old.
- Daytona deactivates snapshots that go unused for 2 weeks.

## Observability and retention

- Each run gets a folder on the Fly volume for its artifacts, plus a row in SQLite with:
  - ticket and trigger
  - snapshot version
  - catch-up time
  - exit code and duration
  - the PR it produced
- Run folders are kept for 30 days. When under 20% of the volume is free, `sweep-runs` deletes the oldest until 25% is, never a run in flight's. SQLite rows are kept forever.
- The Inngest dashboard covers orchestration: steps, retries and failures.

## Known follow-ups

- Prove Claude Code's OAuth token works through the Daytona Secret swap. Make `bunny-stack` append to `NODE_EXTRA_CA_CERTS` instead of overwriting it.
- Confirm `daytona snapshot push` exists, so the snapshot needs no third-party registry.
- Gaps in the Bunny stack:
  - no PrinceXML, so PDFs fail
  - the login, widget and admin routes are missing
  - the integration tests aren't wired up
  - `bin/verify*` needs a native version
- Chromium needs the cert in its NSS store, or `ignoreHTTPSErrors`.
- Daytona Tier 1/2 limits network access: any third-party API Bunny calls at runtime will fail in the sandbox.
- Check that your employer is fine with a personal Claude subscription working on company code.

## Deferred

- Ticket sources
- Tasks
