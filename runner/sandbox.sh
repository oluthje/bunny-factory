#!/usr/bin/env bash
# Drive a runner sandbox by hand from the Mac: the steps the orchestrator will automate.
#
#   runner/sandbox.sh create <name> [snapshot]     create with the Claude Secret, auto-stop off; wait until started
#   runner/sandbox.sh exec <name> [--timeout s] <command string>
#                                                  run as the daytona user in a login shell, from ~,
#                                                  keeping Daytona's proxy and CA variables
#   runner/sandbox.sh upload <name> <local> <remote path>
#   runner/sandbox.sh download <name> <remote path> <local>
#   runner/sandbox.sh delete <name>                delete and wait until it is gone
#
# Reads DAYTONA_API_KEY from the repo root's .env (or $ENV_FILE). The snapshot defaults to the
# one in runner/out/latest-snapshot. The Claude token is never sent from here: the sandbox gets
# the Daytona Secret $CLAUDE_SECRET (default claude-oauth-token) as CLAUDE_CODE_OAUTH_TOKEN, and
# only Daytona's egress proxy swaps in the real value, on HTTPS requests to Anthropic.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ENV_FILE=${ENV_FILE:-$HERE/../.env}
[[ -f $ENV_FILE ]] || { echo "no $ENV_FILE (copy .env.example)" >&2; exit 1; }
set -a; source "$ENV_FILE"; set +a
API=https://app.daytona.io/api
TOOLBOX=https://proxy.app.daytona.io/toolbox
DT=${DAYTONA_CLI:-daytona-v0}
CLAUDE_SECRET=${CLAUDE_SECRET:-claude-oauth-token}

die() { echo "sandbox.sh: $*" >&2; exit 1; }
api() { curl -sS -H "Authorization: Bearer $DAYTONA_API_KEY" "$@"; }
sandbox_id() { api "$API/sandbox/$1" | jq -er .id || die "no sandbox $1"; }
state() { api "$API/sandbox/$1" | jq -r '.state // "gone"'; }

cmd=${1:-}; shift || true
case $cmd in
  create)
    name=${1:?name}; snap=${2:-$(cat "$HERE/out/latest-snapshot" 2>/dev/null || true)}
    [[ -n $snap ]] || die "no snapshot given and runner/out/latest-snapshot is missing"
    jq -n --arg n "$name" --arg s "$snap" --arg sec "$CLAUDE_SECRET" '{
        snapshot: $s, name: $n, autoStopInterval: 0, labels: {purpose: "factory"},
        secrets: [{CLAUDE_CODE_OAUTH_TOKEN: $sec}] }' \
      | api -X POST -H 'Content-Type: application/json' --data @- "$API/sandbox" \
      | jq -e '.id' >/dev/null || die "create failed"
    for _ in $(seq 1 100); do
      st=$(state "$name")
      case $st in started) echo "started: $name ($snap)"; exit 0 ;; error|build_failed) die "state $st" ;; esac
      sleep 3
    done
    die "$name did not start in time (state $st)"
    ;;
  exec)
    name=${1:?name}; shift; timeout=0
    [[ ${1:-} == --timeout ]] && { timeout=$2; shift 2; }
    [[ $# -ge 1 ]] || die "usage: exec <name> [--timeout s] <command string>"
    # Exec runs as root. -E keeps Daytona's HTTPS_PROXY / CA variables and the Secret placeholder;
    # a login shell adds ~/.local/bin (claude) and the NO_PROXY profile script.
    exec "$DT" exec "$name" --timeout "$timeout" -- sudo -E -u daytona -H bash -lc "cd ~ && $*"
    ;;
  upload)
    name=${1:?name}; src=${2:?local file}; dst=${3:?remote path}
    api -o /dev/null -w '%{http_code}' "$TOOLBOX/$(sandbox_id "$name")/files/upload-v2?path=$dst" \
      --form "file=@$src" | grep -q '^200$' || die "upload failed"
    "$DT" exec "$name" -- chown daytona:daytona "$dst" >/dev/null
    ;;
  download)
    name=${1:?name}; src=${2:?remote path}; dst=${3:?local file}
    code=$(api -o "$dst" -w '%{http_code}' "$TOOLBOX/$(sandbox_id "$name")/files/download?path=$src")
    [[ $code == 200 ]] || { rm -f "$dst"; die "download of $src failed ($code)"; }
    ;;
  delete)
    name=${1:?name}
    "$DT" delete "$name" >/dev/null 2>&1 || true
    for _ in $(seq 1 40); do [[ $(state "$name") == gone || $(state "$name") == destroyed ]] && { echo "deleted: $name"; exit 0; }; sleep 3; done
    die "$name still exists"
    ;;
  *) sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 2 ;;
esac
