---
name: factory-stack
description: Reference for the Bunny stack in a factory run: repos, services, specs, browser login and runner gaps. Use when running, testing or looking at Bunny during a factory run.
---

## Repos

The Bunny repos are in `~/bunny`: `api` (Rails), `app` and `portal` (Vite), and `kong`. Each has its own `CLAUDE.md` / `AGENTS.md`; read it before changing that repo.

`components`, `docs`, `docs-developer`, `skills-internal` and `integration-tests` are there too, checked out like the others, but nothing is installed or running for them:

- `components` is the `@bunnyapp/components` package. `app` and `portal` install it from npm, so a change here doesn't reach the running stack. To run its checks, `npm ci` there first.
- `docs` is the public docs site (Jekyll, with Tailwind through npm). Its gems and `node_modules` aren't installed.
- `docs-developer` is the developer docs, in GitBook markdown. There's nothing to build.
- `skills-internal` is the Bunny AI agent's skills (`SKILL.md` files), a gem the api loads from GitHub at the commit its `Gemfile.lock` pins. The running api doesn't read `~/bunny/skills-internal`, so an edit there doesn't reach the chat. The api picks up a change only after the skills-internal PR merges and a later api PR bumps the pin with `bundle update skills-internal --conservative`. Don't bump it in the same run: the pin must name a commit on skills-internal's `main`. To try an edit in the running stack, run `bundle config set --local local.skills-internal ~/bunny/skills-internal` and `bundle config set --local disable_local_branch_check true` in `~/bunny/api`, then `bunny-stack restart api`. That also rewrites the api's `Gemfile.lock`: afterwards, `bundle config unset --local local.skills-internal`, `bundle config unset --local disable_local_branch_check` and `git checkout Gemfile.lock`, and commit none of it.
- `integration-tests` is the Cucumber + Capybara end-to-end suite. It isn't wired to this stack, so its scenarios don't run here; edit its features and steps by reading them.

Set one up only when the ticket needs it.

## Stack

Every service is already running natively (no Docker): Rails, Solid Queue, both Vite servers, Postgres, Redis, maildev and Caddy.

- App: https://bunny.bunny.internal/app
- Portal: https://bunny.bunny.internal/portal
- Mail: http://127.0.0.1:8025
- Manage services with `bunny-stack status`, `bunny-stack logs <svc>`, `bunny-stack restart <svc>` and `bunny-stack run api <command>`.

## Specs

`cd ~/bunny/api && bin/rspec <files>`. The test database is prepared.

## Migrations

Create a migration with `bunny-stack run api bin/rails generate migration <Name>`, so its version is the current time. Never type a version yourself, rounded or invented: other runs are writing migrations for related tickets at the same time, their branches are merged together, and Rails refuses two migrations with the same version.

## Browser

A headless Chromium is available through the Playwright MCP server, and it trusts the `bunny.internal` certificate. To log in as the seeded admin, open the URL this prints:

```sh
bunny-stack run api bin/rails runner 'puts Users::GenerateLoginLink.call(user: User.find_by!(email: "admin@bunny.com"), host: "bunny.bunny.internal").data[:login_url]'
```

## Runner gaps

What production does that the runner can't. They fail because of the runner, not because of the code:

- The login, widget, metabase and admin routes return 502: those services aren't in the stack. Login itself works: it lives in app at `/app/login`.
- Third-party APIs are unreachable: the runner's network is restricted.
- There is no GitHub or Linear access.
- **Gateway rate limits.** Production Kong limits `/graphql` per token; Caddy doesn't. Rails' own limits (token issuance, `/oauth/register`) do run.
- **Gateway behaviour we can't see.** The production Kong config lives in a `kubernetes-infrastructure` repo; `kong/kong-production.yml` is from 2022. Request size limits, allowlists and any other plugins are unknown.
- **Other hosts.** Only `bunny.bunny.internal` resolves, so behaviour across warrens and on the generic `auth` host is limited.

Auth is not a gap: Rails validates tokens, not Kong, and Caddy routes `/oauth`, `/graphql`, `/api` and `/.well-known/oauth-*` as Kong does.
