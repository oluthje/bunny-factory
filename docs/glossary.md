# Glossary

The shared language for the Bunny factory. Use these terms, and only these, in code, docs, tickets and PRs. When you reach for a word under _Avoid_, use the canonical term instead.

A vendor's own name for its object is fine when you mean that object specifically (a Daytona _sandbox_, a Daytona _session_, a GitHub Actions _workflow_). Don't use it as a name for the factory concept.

## The factory

**Software factory**:
A system of agents that turns tickets, PRs and schedules into merged code, deployed on remote infrastructure we choose. A design has two halves: the **services**, each a slot filled with a product, and the **tasks** whose runs move work through them.

## Tasks and runs

**Task**:
A kind of work the factory performs, defined once and run many times: explore, implement, review, merge, ratchet. A task may work on a ticket, a PR, or the codebase as a whole.
_Avoid_: job, workflow, action

**Trigger**:
The event that starts a run: a change in the ticket tracker or git host, a clock in the orchestrator, or another run.

**Run**:
One execution of a task on one runner, from its trigger to its finish, treated as a black box. A run never waits for a human: it ends, and the human's later change to the ticket tracker or git host triggers a new run.
_Avoid_: session

**Runner**:
The disposable machine a run executes on. Nothing on it survives the run: a run's only memory of earlier runs is the ticket tracker, the git host and the orchestrator.
_Avoid_: server, host, box, compute, sandbox

## Services

**Service**:
A slot in the factory's design, filled with a product. One product can fill several slots.

**Ticket tracker**:
Where tickets live, and the factory's human interface: humans schedule work by filing tickets, talk to agents in their comments, and their changes to tickets trigger runs.
_Avoid_: issue tracker, ticket manager, project board

**Ticket source**:
Anything outside the factory that creates tickets in the ticket tracker: a feedback button, a monitor, an error tracker, an inbox.
_Avoid_: data source, trigger source, intake

**Git host**:
Where branches, PRs and reviews live.
_Avoid_: code host, forge, repo

**Orchestrator**:
The component that receives triggers, starts runs on runners, and records which runs are queued, in flight or finished.
_Avoid_: dispatcher, scheduler, control plane

**Observability platform**:
Where runners send logs, traces and status, so a human can see what happened inside each run. Optional.
_Avoid_: observability, logs, monitoring, dashboard

## Brakes

Every trigger is an accelerator; brakes keep the factory from becoming a slop cannon.

**Automated checks**:
Deterministic gates (types, lint, tests) that every run must pass.

**Automated review**:
A separate run that reads the diff cold against the codebase's standards and the ticket, when there is one.

**Human review**:
A human reads the PR before it merges. What it catches becomes new automated checks and sharper automated review.

**Throttle**:
A limit on how often a trigger fires (one bug report in ten, a clock once a day). Opened as the brakes earn trust.

**Merge check**:
The merge task's gate before any merge: an agent judges whether each of the ticket's PRs is an easy call, then the orchestrator's own checks (CI green, mergeable, not into production, unchanged since judged) must pass too. All of a ticket's PRs merge, or none.

**Dry run**:
The factory doing everything a merge needs except merging, and saying what it would merge. On until `FACTORY_MERGE_DRY_RUN` is `false`.

**Loop cap**:
The maximum number of tries in a loop of runs before a human must step in.
