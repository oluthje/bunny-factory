# runner

A Daytona snapshot that runs the bunny stack **without Docker**, so a coding agent can make
and verify end-to-end changes inside one small sandbox.

The team's standard stack (hop + docker compose) is untouched. This repo clones `api`,
`app`, `portal` and `kong` and runs them as they are. It also clones `components`, `docs`,
`docs-developer`, `skills-internal` and `integration-tests`, but installs and runs nothing for them. Nothing in those repos is edited apart
from the gitignored `.env` files and build output.

## What runs where

| Standard stack (containers) | Here (plain processes) |
|---|---|
| `api` | `bundle exec rails server` on :3000, Puma in single mode |
| `queue` (5 processes) | `bin/jobs --mode=async -c stack/queue.yml`, one process |
| `app`, `portal` | Vite on :3002 and :3006 |
| `kong` | Caddy on :80/:443 (`stack/Caddyfile`, a port of `kong/kong.yml`) |
| `postgres:18`, `redis:7`, `maildev` | the same versions, run natively |

`bunny-infra` (runs as root at boot) starts postgres, redis, maildev and caddy. `bunny-stack`
(runs as the `daytona` user) does everything else:

```sh
bunny-stack up                 # first run: clone, gems, npm, db:setup + seeds; then start all
                               # (checks the snapshot fits the code, rebuilds databases ahead of it)
bunny-stack status
bunny-stack logs api -f
bunny-stack restart app
bunny-stack run api bin/rails c
bunny-stack run api env RAILS_ENV=test bin/rails db:prepare   # once, before running specs
bunny-stack smoke              # end-to-end check through caddy
bunny-stack down
```

Browse at `https://bunny.bunny.internal/app` and `/portal`. Mail is at `http://127.0.0.1:8025`.
The team's `bunny.internal` dev cert, taken from the kong repo, is trusted system-wide. For
Playwright, either pass `ignoreHTTPSErrors: true` or add the cert to Chromium's NSS store.

## Keeping in step with the standard stack

These files copy settings from the team's setup. When those change, update them:

- `stack/api.env` copies the `environment:` block of the api service in hop's compose template.
- `stack/Caddyfile` copies `kong/kong.yml`.
- `svc_cmd` in `stack/bunny-stack` copies the `npm start` scripts and the compose commands.
- `Dockerfile` copies the Ruby version from `api/.ruby-version`.
- `Dockerfile` copies the PrinceXML major version and font packages from `api/Dockerfile`.

## Differences from the standard stack
- All job queues share one worker thread. A chat turn can wait behind a batch job that is
  already running.
- Puma runs one process. To change that, set `WEB_CONCURRENCY=2` in `~/bunny/stack.env`.
- kong's `/login`, `/widget`, `/bi` (metabase) and `/packs`/`/assets` (admin) routes return 502.
  Those services aren't in the stack. Login itself works: it lives in app at `/app/login`.
- The integration-tests runner isn't wired up.

## Building

Snapshots are built on your Mac, never inside a sandbox: Tier 1/2 sandboxes can't reach
`gems.graphql.pro`, so a cold `bundle install` there fails.

1. Copy `.env.example` at the repo root to `.env` and fill it in. `.env` is gitignored and sits
   outside `runner/`, which is the build context Daytona uploads.
2. Turn on Docker Desktop's "Use Rosetta for x86_64/amd64 emulation" (Daytona runs amd64).
3. Run `runner/build-snapshot.sh`. It builds `Dockerfile` (the base) and `Dockerfile.warm` (repos,
   gems, `node_modules`, Chromium, dev and test databases), checks the image for the PAT, then
   pushes it to Daytona with `daytona-v0 snapshot push`. `--no-push` stops after the check.

The GitHub token needs read access to `api`, `app`, `portal`, `kong`, `components`, `docs`,
`docs-developer`, `integration-tests` and the private gem repos (`filter_parser`, `operationable`, `skills-internal`). It reaches the build only as a BuildKit
secret, and run sandboxes never hold it.

To build only the base on Daytona's builder instead, pass the whole directory as context:
`daytona-v0 snapshot create bunny-agent --dockerfile Dockerfile --context .` (a `--context stack`
argument drops the `stack/` directory).
