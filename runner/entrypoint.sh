#!/usr/bin/env bash
# Starts the stack's shared services (postgres, redis, maildev, caddy), then keeps the sandbox
# alive. The app services start on demand: `bunny-stack up` as the daytona user.
/usr/local/bin/bunny-infra start >/var/log/bunny-infra.log 2>&1 || true
# GitHub over HTTPS with the sandbox's GH_TOKEN, for the agent user.
[[ -n "${GH_TOKEN:-}" ]] && sudo -u daytona -E gh auth setup-git >/dev/null 2>&1 || true
exec sleep infinity
