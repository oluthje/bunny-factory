# Bunny factory

A software factory for Bunny: agents that turn tickets, PRs and schedules into merged code. The design is in [docs/services.md](docs/services.md); the vocabulary is in [docs/glossary.md](docs/glossary.md).

The orchestrator runs on Fly.io as the app `oscar-bunny-factory`: one always-on machine, with a 40 GB volume at `/data` holding `factory.db`, the git mirrors and the run folders. The laptop never starts runs: only a machine with the secret `FACTORY_POLL=on` does, and only Fly has it. Local work means tests (`cd orchestrator && npm test`).

## The `fac` CLI

`bin/fac` drives the factory on Fly. Put it on your PATH once:

```sh
ln -s "$PWD/bin/fac" ~/.local/bin/fac
```

Each command runs `orchestrator/scripts/factory.ts` inside the machine over `fly ssh console`, against its SQLite. It needs `flyctl`, logged in.

| Command | What it does |
| --- | --- |
| `fac status` | One screen: the state (running, draining with the runs left, or stopped) and the deployed commit; the runs in flight with ticket, task, current step and time elapsed, out of `FACTORY_MAX_RUNS`; the last 10 finished runs with outcome, duration and PR; and health: when Linear was last polled, disk used, days until the GitHub PAT expires, and the snapshot's age. `⚠` marks anything to act on. |
| `fac stop` | Drains. No new run starts. A queued run with no runner yet ends `cancelled`, keeps its task label, and doesn't count toward the loop cap. Runs that already have a runner finish. |
| `fac stop --now` | Stops at once: every run in flight is cancelled, its runner deleted, and its ticket's task label put back, so it runs again after `start`. |
| `fac start` | New runs start again on the next poll. Tickets labelled while the factory was stopped are picked up then. |

The state is a row in `factory.db`, so it survives deploys and restarts. `sweep-runs` keeps running while the factory is stopped. For logs, use `fly logs -a oscar-bunny-factory` and the Inngest dashboard.

## Deploys

Every push to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml): `npm ci`, `typecheck` and `test` in `orchestrator/`, then `flyctl deploy`, then a resync of Inngest Cloud. A failed check deploys nothing. Deploys queue behind each other. A deploy goes out with runs in flight: the machine restarts, and Inngest retries the step it cut off.

## Disk

`sweep-runs` deletes run folders (`/data/runs/<id>`) older than 30 days, and when under 20% of the volume is free, the oldest ones until 25% is. It never deletes a run in flight's folder, the mirrors or `factory.db`, and SQLite rows are kept. `fac status` warns when that isn't enough.

## Setting up Fly from scratch

[orchestrator/scripts/fly-cutover.sh](orchestrator/scripts/fly-cutover.sh) walks through the steps only a human can do: stopping the local orchestrator, creating the app, volume and secrets, the first deploy, copying `factory.db` up, syncing Inngest Cloud, and the deploy token for GitHub. Run it from the repo root.
