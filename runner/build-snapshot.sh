#!/usr/bin/env bash
# Builds the warm runner snapshot on this Mac and pushes it to Daytona.
#
#   runner/build-snapshot.sh            build base + warm images, check for the PAT, push
#   runner/build-snapshot.sh --no-push  stop after the leak check
#
# Reads GH_TOKEN (and SNAPSHOT_NAME, SANDBOX_CPU, SANDBOX_MEMORY, SANDBOX_DISK) from the repo
# root's .env (gitignored, outside the runner/ build context; see .env.example), or $ENV_FILE.
# The PAT reaches the build only as a BuildKit secret (--secret), never as a build arg.
#
# Needs Docker with linux/amd64 support (Daytona runs amd64). On Apple Silicon, turn on
# Docker Desktop's "Use Rosetta for x86_64/amd64 emulation"; QEMU is far slower.
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\033[34m▸\033[0m %s\n' "$*"; }
die() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

PUSH=1; [[ ${1:-} == --no-push ]] && PUSH=0
ENV_FILE=${ENV_FILE:-../.env}
[[ -f $ENV_FILE ]] || die "no $ENV_FILE: copy .env.example to .env at the repo root and fill it in"
set -a; source "$ENV_FILE"; set +a
[[ -n ${GH_TOKEN:-} ]] || die "GH_TOKEN missing from $ENV_FILE"

DT=${DAYTONA_CLI:-daytona-v0}
STAMP=$(date +%Y%m%d-%H%M)
BASE_TAG=bunny-agent-base:$STAMP
WARM_REPO=${SNAPSHOT_NAME:-bunny-agent}-warm
WARM_TAG=$WARM_REPO:$STAMP          # Daytona rejects latest/lts/stable tags
SNAPSHOT=$WARM_REPO-$STAMP
mkdir -p out
LOG=out/build-$STAMP.log

# The commit each repo's main is at, so the clone layer rebuilds when any of them moves.
shas=""
for r in api app portal kong; do
  sha=$(GH_TOKEN=$GH_TOKEN gh api "repos/bunnyapp/$r/commits/main" --jq .sha) || die "can't read bunnyapp/$r"
  shas+="$r@${sha:0:12} "
done
say "repos: $shas"

t0=$SECONDS
say "building $BASE_TAG (log: $LOG)"
docker buildx build --platform linux/amd64 --load -f Dockerfile -t "$BASE_TAG" . >>"$LOG" 2>&1 \
  || die "base build failed: tail $LOG"
say "base built in $((SECONDS - t0))s"

t1=$SECONDS
say "building $WARM_TAG"
docker buildx build --platform linux/amd64 --load -f Dockerfile.warm \
  --build-arg "BASE_IMAGE=$BASE_TAG" --build-arg "REPO_SHAS=$shas" \
  --secret id=gh_token,env=GH_TOKEN \
  -t "$WARM_TAG" . >>"$LOG" 2>&1 || die "warm build failed: tail $LOG"
say "warm built in $((SECONDS - t1))s ($(docker image inspect -f '{{.Size}}' "$WARM_TAG" | awk '{printf "%.1f GB", $1/1e9}'))"

# The PAT must not appear anywhere in the image: build history, any layer, or the flattened
# filesystem. Also check the base64 header form git was given.
say "checking the image for the PAT"
b64=$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 | tr -d '\n')
leak=0
# Count matches over the whole stream: grep -q would stop early, SIGPIPE the producer, and under
# pipefail a real match would then look like a clean result.
count() { local n; n=$(grep -acF -e "$GH_TOKEN" -e "$b64") || true; echo "${n:-0}"; }
[[ $(docker history --no-trunc --format '{{.CreatedBy}}' "$WARM_TAG" | count) == 0 ]] || { echo "  found in build history"; leak=1; }
[[ $(docker save "$WARM_TAG" | count) == 0 ]] || { echo "  found in a saved layer"; leak=1; }
cid=$(docker create --platform linux/amd64 "$WARM_TAG")
[[ $(docker export "$cid" | count) == 0 ]] || { echo "  found in the filesystem"; leak=1; }
docker rm "$cid" >/dev/null
((leak == 0)) || die "the PAT is in $WARM_TAG: do not push it. Delete it with: docker rmi $WARM_TAG"
say "no trace of the PAT in history, layers or filesystem"

if ((PUSH == 0)); then say "built $WARM_TAG; not pushed (--no-push)"; exit 0; fi

t2=$SECONDS
say "pushing $WARM_TAG to Daytona as snapshot $SNAPSHOT"
"$DT" snapshot push "$WARM_TAG" --name "$SNAPSHOT" \
  --cpu "${SANDBOX_CPU:-4}" --memory "${SANDBOX_MEMORY:-8}" --disk "${SANDBOX_DISK:-10}" \
  --entrypoint /usr/local/bin/entrypoint.sh >>"$LOG" 2>&1 || die "push failed: tail $LOG"
say "pushed in $((SECONDS - t2))s; total $((SECONDS - t0))s"
echo "$SNAPSHOT" >out/latest-snapshot
say "snapshot: $SNAPSHOT (also in runner/out/latest-snapshot)"
