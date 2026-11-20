---
name: factory-stack
description: Reference for the Bunny stack in a factory run: repos, services, specs, browser login and known gaps. Use when running, testing or looking at Bunny during a factory run.
---

## Repos

The Bunny repos are in `~/bunny`: `api` (Rails), `app` and `portal` (Vite), and `kong`. Each has its own `CLAUDE.md` / `AGENTS.md`; read it before changing that repo.

`components`, `docs` and `docs-developer` are there too, checked out like the others, but nothing is installed or running for them:

- `components` is the `@bunnyapp/components` package. `app` and `portal` install it from npm, so a change here doesn't reach the running stack. To run its checks, `npm ci` there first.
- `docs` is the public docs site (Jekyll, with Tailwind through npm). Its gems and `node_modules` aren't installed.
- `docs-developer` is the developer docs, in GitBook markdown. There's nothing to build.

Set one up only when the ticket needs it.

## Stack

Every service is already running natively (no Docker): Rails, Solid Queue, both Vite servers, Postgres, Redis, maildev and Caddy.

- App: https://bunny.bunny.internal/app
- Portal: https://bunny.bunny.internal/portal
- Mail: http://127.0.0.1:8025
- Manage services with `bunny-stack status`, `bunny-stack logs <svc>`, `bunny-stack restart <svc>` and `bunny-stack run api <command>`.

## Specs

`cd ~/bunny/api && bin/rspec <files>`. The test database is prepared.

## Browser

A headless Chromium is available through the Playwright MCP server, and it trusts the `bunny.internal` certificate. To log in as the seeded admin, open the URL this prints:

```sh
bunny-stack run api bin/rails runner 'puts Users::GenerateLoginLink.call(user: User.find_by!(email: "admin@bunny.com"), host: "bunny.bunny.internal").data[:login_url]'
```

## Known gaps

These fail because of the runner, not because of your change:

- The login, widget, metabase and admin routes return 502: those services aren't in the stack.
- PDF rendering fails: PrinceXML isn't installed.
- Third-party APIs are unreachable: the runner's network is restricted.
- There is no GitHub or Linear access.
