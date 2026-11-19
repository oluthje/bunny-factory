# Running a full web-app dev stack in Daytona sandboxes for coding agents

> Written for the earlier `~/development/daytona-setup` test run, whose files now live in `runner/`. Its `wizard.sh` was not carried over.

Researched 2026-11-18. Daytona doc pages show no per-page dates. Everything below is from what was live on that date. Sources fall into three groups:

- **Daytona v0 docs** at `daytona.io/docs`. v0 is the platform this setup uses (CLI `daytona-v0`, API `app.daytona.io`).
- **Daytona OSS source** at `github.com/daytonaio/daytona`. The repo was frozen at **v0.190.0 in June 2026** ([README notice](https://github.com/daytonaio/daytona)). Hosted Daytona may now behave differently from that source.
- **Upstream docs** for Playwright, Puppeteer, Chrome DevTools MCP, Chromium, Vite and Docker.

Items marked **[community]** are secondary evidence: GitHub issues filed by users, and third-party blogs.

> **Big-picture change:** Daytona now runs two platforms. **v0** (`daytona.io`) is called "the current platform". **v2** (`daytona.com`) is "the next version", with its own API, dashboard and resource model ([Upgrade to v2](https://www.daytona.io/docs/en/upgrade-to-v2.md)). When CLI 2.0.0 becomes the default release, `daytona` will install the v2 CLI; v0 scripts should call `daytona-v0` ([CLI docs](https://www.daytona.io/docs/en/tools/cli.md)). Everything below is v0 unless it is marked v2.

---

## TL;DR: the most important practices

1. **Auto-stop ignores your processes.** Container sandboxes stop after 15 minutes of inactivity by default. Only these reset the timer: preview requests, SSH sessions, Toolbox API calls and lifecycle changes. Background processes such as an agent loop or `npm run dev` do not ([Sandboxes: auto-stop](https://www.daytona.io/docs/en/sandboxes.md#auto-stop-interval)). For long agent runs, either drive the agent through Toolbox/SSH, call `refreshActivity()` regularly, or set auto-stop to `0` and add a wall-clock `ttl` as the backstop ([Wall-clock TTL](https://www.daytona.io/docs/en/sandboxes.md#wall-clock-ttl)).
2. **A stop throws away memory.** Stopping a container sandbox terminates it. Files survive, processes do not, and the entrypoint runs again on the next start ([Stop sandboxes](https://www.daytona.io/docs/en/sandboxes.md#stop-sandboxes), [Persistence](https://www.daytona.io/docs/en/persistence.md)). Make the stack idempotent to bring back up after every start.
3. **Bake the slow, stable parts; clone the per-ticket parts.** Daytona's own pattern is "prepare the environment once, capture it as a snapshot", then fan out ([Scale: fleet scaling](https://www.daytona.io/docs/en/scale.md)). A snapshot taken from a prepared sandbox can hold installed gems, `node_modules` and a seeded DB ([Snapshots: create from sandbox](https://www.daytona.io/docs/en/snapshots.md#create-snapshot-from-sandbox)). That is the main lever on cold start.
4. **Run services natively, not with Docker-in-Docker.** DinD needs at least 2 vCPU / 4 GiB for daemon overhead alone ([Snapshots: Docker-in-Docker](https://www.daytona.io/docs/en/snapshots.md#run-docker-in-a-sandbox)). It has also failed intermittently on some runners with read-only cgroups **[community]** ([#5146](https://github.com/daytonaio/daytona/issues/5146)).
5. **Let Playwright launch Chromium.** Playwright already passes `--no-sandbox` (unless `chromiumSandbox: true`) and `--disable-dev-shm-usage` ([chromium.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromium.ts), [chromiumSwitches.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromiumSwitches.ts)). That removes the two classic container failures: sandbox errors and a 64 MB `/dev/shm`. Chrome DevTools MCP / Puppeteer does **not** add `--no-sandbox` by default ([ChromeLauncher.ts](https://github.com/puppeteer/puppeteer/blob/main/packages/puppeteer-core/src/node/ChromeLauncher.ts)), and Chrome will not start as root ([chrome-devtools-mcp troubleshooting](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/troubleshooting.md)).
6. **Know which user the agent runs as.** In the OSS runner, the Daytona daemon is PID 1. Your image ENTRYPOINT runs as an async "entrypoint session", and the runner sets no container `User` ([container_configs.go@v0.190.0](https://github.com/daytonaio/daytona/blob/v0.190.0/apps/runner/pkg/docker/container_configs.go), [daemon main.go@v0.190.0](https://github.com/daytonaio/daytona/blob/v0.190.0/apps/daemon/cmd/daemon/main.go)). The image's final `USER` therefore decides who runs Toolbox/exec commands. Check it.
7. **Size against tier quotas, including stopped sandboxes.** The default per-sandbox maximum is 4 vCPU / 8 GiB / 10 GiB ([Resources](https://www.daytona.io/docs/en/sandboxes.md#resources)). Stopped container sandboxes **keep using disk quota until archived**, and auto-archive defaults to 7 days ([Limits: disk quota](https://www.daytona.io/docs/en/limits.md#disk-quota)). On Tier 1 (30 GiB of storage), three 10 GiB sandboxes fill the org.
8. **Tier 1 and Tier 2 have locked-down egress.** Only "essential services" are reachable (GitHub, npm, RubyGems, `*.ubuntu.com`, Anthropic, etc.), and sandbox-level allow lists cannot widen that ([Network limits](https://www.daytona.io/docs/en/network-limits.md#tier-based-network-restrictions)). Third-party APIs that the app calls at runtime will fail below Tier 3.
9. **Preview URLs are `https://{port}-{sandboxId}.{proxyDomain}`.** Any port 1–65535 works. The standard token is a **sandbox-wide credential**: it also unlocks the terminal (22222) and Toolbox (2280). Share signed URLs instead ([Preview](https://www.daytona.io/docs/en/preview.md)).
10. **Put a long-keepalive proxy in front of Vite.** Daytona's proxy reuses pooled connections. Node's 5 s keep-alive makes Vite drop them, and the proxy then returns `400 "bad request: 404 Not Found"` after short idles **[community]** ([#3846](https://github.com/daytonaio/daytona/issues/3846), [#3899](https://github.com/daytonaio/daytona/issues/3899)). A reverse proxy such as Caddy in front of Vite, or a raised `keepAliveTimeout`, avoids it.
11. **Keep tokens out of the sandbox.** Daytona Secrets put an opaque placeholder in the environment variable, and the egress proxy swaps in the real value only in HTTPS headers sent to allow-listed hosts ([Secrets](https://www.daytona.io/docs/en/secrets.md)). This matters for agent sandboxes that hold `GH_TOKEN` or Claude credentials.
12. **Snapshots go inactive after 2 weeks unused.** They must be re-activated before use ([Activate snapshots](https://www.daytona.io/docs/en/snapshots.md#activate-snapshots)). Rebuild or refresh on a schedule so the factory never hits a dead snapshot.

---

## 1. Headless Chromium in a Daytona sandbox

### What the sandbox looks like to Chrome
- **Container class (the default):**
  - It is an isolated container with namespaces and hard cgroup limits, and code runs as root inside it ([Isolation](https://www.daytona.io/docs/en/isolation.md#runtime-isolation)).
  - `nproc` and `free` show **host** values. Read `/sys/fs/cgroup/cpu.max` and `memory.max` for the real limits (same page). Tools that size worker pools from `os.cpus()` can over-subscribe. Set Playwright `workers` explicitly; it accepts a number or a percentage of *logical cores* ([TestConfig.workers](https://playwright.dev/docs/api/class-testconfig#test-config-workers)).
- **OSS runner (v0.190.0) container settings:**
  - Non-GPU sandboxes are created `Privileged: true`.
  - `MemorySwap == Memory`, so there is no swap and memory exhaustion is an OOM kill.
  - No `ShmSize` is set ([container_configs.go](https://github.com/daytonaio/daytona/blob/v0.190.0/apps/runner/pkg/docker/container_configs.go)). Docker's default `/dev/shm` is 64 MB ([docker run reference](https://docs.docker.com/reference/cli/docker/container/run/)).
  - Hosted runners also include Kata/Cloud Hypervisor kernels **[community]** ([#5146](https://github.com/daytonaio/daytona/issues/5146)), so do not assume the OSS settings. Run `df -h /dev/shm` in your own sandbox.
  - A co-located OOM surfaced as `exit 137` and the sandbox becoming unreachable **[community]** ([#5137](https://github.com/daytonaio/daytona/issues/5137)).

### Flags and permissions
| Concern | Playwright (`chromium.launch`, Playwright MCP) | Puppeteer / Chrome DevTools MCP |
|---|---|---|
| Chrome sandbox | Adds `--no-sandbox` unless `chromiumSandbox: true` ([chromium.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromium.ts)). Its Docker guide says root disables the Chromium sandbox, which is fine for trusted E2E code ([Playwright Docker](https://playwright.dev/docs/docker)). | Does not add `--no-sandbox` by default; set `PUPPETEER_DANGEROUS_NO_SANDBOX=true` or pass `--no-sandbox` ([ChromeLauncher.ts](https://github.com/puppeteer/puppeteer/blob/main/packages/puppeteer-core/src/node/ChromeLauncher.ts), [pptr troubleshooting](https://pptr.dev/troubleshooting#setting-up-chrome-linux-sandbox)). Chrome "does not start as root" (crbug 638180), so run chrome-devtools-mcp as a non-root user ([troubleshooting](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/troubleshooting.md)). |
| `/dev/shm` | `--disable-dev-shm-usage` is always passed ([chromiumSwitches.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromiumSwitches.ts)). Its Docker guide recommends `--ipc=host`, which Daytona does not expose; the flag covers it. | Also passes `--disable-dev-shm-usage` by default ([ChromeLauncher.ts](https://github.com/puppeteer/puppeteer/blob/main/packages/puppeteer-core/src/node/ChromeLauncher.ts)). |
| Headless | Playwright MCP is **headed by default**; pass `--headless`. Its browser default is the Chrome channel; use `--browser chromium` or `--executable-path` for Playwright's bundled build ([playwright-mcp README](https://github.com/microsoft/playwright-mcp)). | `--headless`. The default channel is stable Google Chrome; point `--executablePath` at another Chromium. Only Chrome / Chrome for Testing are officially supported ([config](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md), [README](https://github.com/ChromeDevTools/chrome-devtools-mcp)). |
| Concurrency / profile | A persistent profile allows one browser at a time. Use `--isolated` or separate `--user-data-dir` for parallel clients ([playwright-mcp README](https://github.com/microsoft/playwright-mcp)). | `--isolated` gives a temporary profile ([config](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md)). |
| Self-signed TLS | `ignoreHTTPSErrors` / MCP `--ignore-https-errors` ([playwright-mcp README](https://github.com/microsoft/playwright-mcp)). | `--acceptInsecureCerts` ([config](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md)). |
| Zombies | The Docker guide recommends `--init` against PID-1 zombie problems ([Playwright Docker](https://playwright.dev/docs/docker)). In Daytona, PID 1 is the Daytona daemon ([daemon main.go](https://github.com/daytonaio/daytona/blob/v0.190.0/apps/daemon/cmd/daemon/main.go)). Whether it reaps orphans was not verified. | Same. |

- **System dependencies:** `npx playwright install --with-deps chromium` or `install-deps` installs them ([Playwright browsers](https://playwright.dev/docs/browsers)). Each Playwright version needs **its own** browser build. Re-run `install` when the Playwright version changes (same page). A repo-pinned `@playwright/test` that differs from the baked `playwright@1` will look for a browser revision that is not there.
- **Headless shell vs new headless:**
  - Headless mode uses `chromium-headless-shell` by default; `--only-shell` skips the full browser download.
  - `channel: 'chromium'` selects "new headless", the real Chrome, which Chrome's team calls more authentic for E2E testing ([Playwright browsers](https://playwright.dev/docs/browsers#chromium-headless-shell)).
  - The headless shell disables GPU compositing unless `--enable-gpu` is passed ([pptr troubleshooting](https://pptr.dev/troubleshooting)). A CPU sandbox has no GPU anyway.
- **Fonts:** Puppeteer's Docker recipe installs `fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf` for CJK/Arabic/Hebrew/Thai ([pptr troubleshooting](https://pptr.dev/troubleshooting#running-puppeteer-in-docker)). Playwright's `install-deps` covers the basics; add these only if screenshots must render those scripts.
- **Ubuntu AppArmor:** on Ubuntu 23.10+ hosts, AppArmor can block user namespaces and cause "No usable sandbox!" ([pptr troubleshooting](https://pptr.dev/troubleshooting#issues-with-apparmor-on-ubuntu)). This is moot with `--no-sandbox`.
- **Untrusted content:** Playwright's guidance for scraping untrusted sites is a non-root user plus its seccomp profile ([Playwright Docker](https://playwright.dev/docs/docker)). For an agent testing your own app on localhost, root/`--no-sandbox` is acceptable by that same guidance.

### Local HTTPS / self-signed certs
- On Linux, Chromium reads trust from the **NSS shared DB**, not `/etc/ssl/certs`:
  - Since M146 the default DB is `$HOME/.local/share/pki/nssdb`; an existing `$HOME/.pki/nssdb` is still used if present.
  - Add a self-signed **server** cert with `certutil -d sql:<db> -A -t "P,," -n <name> -i <crt>` (from `libnss3-tools`) ([Chromium Linux cert management](https://chromium.googlesource.com/chromium/src/+/main/docs/linux/cert_management.md)).
  - `update-ca-certificates` does not affect Chromium.
- If a sandbox uses a `domainAllowList`, Daytona's egress proxy terminates TLS. It mounts a CA bundle at `/etc/daytona/netleash/ca.crt` and **sets `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `CURL_CA_BUNDLE`, `GIT_SSL_CAINFO`, …** to it ([Network limits: HTTPS traffic](https://www.daytona.io/docs/en/network-limits.md#https-traffic)). Scripts that overwrite these variables will break egress, and vice versa.

### Daytona's own desktop / Computer Use / VNC
- **What it is:** Computer Use starts Xvfb + xfce4 + x11vnc + noVNC and exposes mouse, keyboard, screenshot and recording APIs ([Computer Use](https://www.daytona.io/docs/en/computer-use.md)).
- **Custom snapshots need the packages:** `xvfb xfce4 xfce4-terminal x11vnc novnc dbus-x11` plus X11 libs. Without them, VNC and Computer Use fail ([VNC: required packages](https://www.daytona.io/docs/en/vnc-access.md#required-packages)).
- **Resolution** is fixed at creation through `VNC_RESOLUTION` (default 1024x768) ([Computer Use](https://www.daytona.io/docs/en/computer-use.md)).
- **No managed browser/CDP endpoint yet:** that is an open feature request. The proposal argues that pixel-clicking is slow and fragile compared with CDP **[community/maintainer proposal]** ([#4456](https://github.com/daytonaio/daytona/issues/4456), [#4445](https://github.com/daytonaio/daytona/issues/4445)).
- **Practical takeaway:** for an agent verifying a web app, headless Playwright or CDP is the main path. Install the VNC packages only if you want a human to watch, at extra image size.

---

## 2. Keeping the stack light

### Resources, limits, quotas
- **Per-sandbox defaults** are 1 vCPU / 1 GiB / 3 GiB. The default org per-sandbox maximum is **4 vCPU / 8 GiB / 10 GiB** ([Resources](https://www.daytona.io/docs/en/sandboxes.md#resources)).
- **Resizing:** CPU and RAM can be increased live. Decreasing them, or growing disk, needs a stopped sandbox ([Scale](https://www.daytona.io/docs/en/scale.md)).
- **Tier pools:**

  | Tier | vCPU / RAM / storage | How to reach it |
  |---|---|---|
  | 1 | 10 vCPU / 10 GiB / 30 GiB | email verified |
  | 2 | 100 / 200 / 300 | card + $25 |
  | 3 | 250 / 500 / 2000 | $500 |
  | 4 | 500 / 1000 / 5000 | $2000 every 30 days |

  Rate limits are, for example, 300 sandbox creates per minute on Tier 1 ([Limits](https://www.daytona.io/docs/en/limits.md)). **Doc inconsistency:** the same page lists Tier 1 RAM as 10 GiB in one table and 20 GiB in another.
- **Disk quota by state:**
  - *Stopped* container sandboxes still count against disk quota.
  - *Archived* ones do not, and are not billed.
  - Stopped sandboxes are billed for disk only ([Limits: disk quota](https://www.daytona.io/docs/en/limits.md#disk-quota), [Billing](https://www.daytona.io/docs/en/billing.md)).
- **Full disk:** a sandbox that hits its storage limit can fail to start with `no space left on device`, with no clean recovery path **[community feature request]** ([#2848](https://github.com/daytonaio/daytona/issues/2848)).

### Snapshot vs declarative builder vs snapshot-from-sandbox
- **Dockerfile snapshots:**
  - `daytona-v0 snapshot create --dockerfile … --context …`; `COPY`/`ADD` sources are added to the context automatically ([Snapshots](https://www.daytona.io/docs/en/snapshots.md#snapshots-from-local-images), [CLI](https://www.daytona.io/docs/en/tools/cli.md)).
  - Images must be **AMD64** (`--platform=linux/amd64` when built on Apple Silicon).
  - `latest`/`lts`/`stable` tags are rejected ([Snapshots](https://www.daytona.io/docs/en/snapshots.md)).
  - `.dockerignore` handling has had bugs **[community]** ([#2600](https://github.com/daytonaio/daytona/issues/2600), [#2760](https://github.com/daytonaio/daytona/issues/2760)).
- **Declarative builder:** images defined in code, built on demand and **cached 24 h per runner**. It can also register a snapshot. Container/GPU class only ([Declarative builder](https://www.daytona.io/docs/en/declarative-builder.md)). It suits per-repo variation; a pre-built snapshot is faster for a fixed base.
- **Snapshot from a sandbox:** container sandboxes support a **cold** (filesystem-only) snapshot of a *stopped* sandbox. New sandboxes start with "nothing to reinstall" ([Snapshots: create from sandbox](https://www.daytona.io/docs/en/snapshots.md#create-snapshot-from-sandbox), [Persistence](https://www.daytona.io/docs/en/persistence.md#snapshots-from-a-sandbox)). Use this to capture installed gems, `node_modules` and a seeded DB.
- **Linux VM class:**
  - Supports **hot snapshots** (memory + processes), **fork** of a running sandbox, and **pause/resume** with memory intact.
  - Cannot be built from a Dockerfile: push an image to a registry, or snapshot a sandbox ([Linux sandboxes](https://www.daytona.io/docs/en/linux-sandboxes.md), [Snapshots: VM](https://www.daytona.io/docs/en/snapshots.md#vm-snapshots)).
  - Lifecycle defaults differ: auto-pause after 60 min, and preview traffic does **not** reset the auto-pause timer ([Persistence: retention](https://www.daytona.io/docs/en/persistence.md#retention-and-lifecycle), [Linux sandboxes](https://www.daytona.io/docs/en/linux-sandboxes.md)).
  - Of all options, this one comes closest to "stack already running at create".
- **Warm pools:**
  - Pre-created running sandboxes; a create claims one instantly.
  - **Only if** the request uses the same snapshot, region and default resources, the `daytona` user, and **no custom env vars, volumes or secrets**.
  - Must be enabled by support ([Warm pools](https://www.daytona.io/docs/en/warm-pools.md)).
- **v2 note:** "snapshots" mean full memory + disk captures that restore with processes running; filesystem-only captures are called "images" ([v2 Snapshots](https://www.daytona.com/docs/snapshots.md), [v2 Images](https://www.daytona.com/docs/images.md)).

### Volumes and dependency caches
- **What volumes are:** FUSE mounts backed by S3, shareable across sandboxes. They are free, limited to 100 per org, and outside the storage quota ([Volumes](https://www.daytona.io/docs/en/volumes.md)).
- **Limits:** they are slower than local disk and **unsuitable for block-storage workloads like database tables** (same page, "Limitations").
- **Practical use:** a shared read-mostly cache, for example a gem or npm tarball cache. Do not put `node_modules`, Postgres data or a hot bundle path on them.

### DinD vs native
- **Daytona's documented DinD path:** `docker:28.3.3-dind` base images or `get.docker.com`, with at least 2 vCPU / 4 GiB recommended ([Snapshots: DinD](https://www.daytona.io/docs/en/snapshots.md#run-docker-in-a-sandbox)).
- **Why teams use it anyway:** some do because their toolchain requires Docker. Encore's Daytona integration (Sep 2026) uses a DinD snapshot for local databases **[community]** ([Encore blog](https://encore.dev/blog/encore-daytona-sandboxes)).
- **Native processes** avoid both the daemon overhead and the cgroup failure mode in [#5146](https://github.com/daytonaio/daytona/issues/5146).

### Lifecycle intervals (container class)
| Setting | Default | Notes |
|---|---|---|
| auto-stop | 15 min inactivity | `0` disables it. Background processes do **not** count as activity ([auto-stop](https://www.daytona.io/docs/en/sandboxes.md#auto-stop-interval)). |
| auto-archive | 7 days stopped | `0` means the 30-day maximum ([auto-archive](https://www.daytona.io/docs/en/sandboxes.md#auto-archive-sandboxes)). |
| auto-delete | disabled | `0` deletes on stop, `-1` disables ([auto-delete](https://www.daytona.io/docs/en/sandboxes.md#auto-delete-sandboxes)). |
| ttl | none | Wall-clock deadline that destroys the sandbox in any state ([TTL](https://www.daytona.io/docs/en/sandboxes.md#wall-clock-ttl)). |
| ephemeral | off | Deleted when stopped ([Ephemeral](https://www.daytona.io/docs/en/sandboxes.md#ephemeral-sandboxes)). |

- `refreshActivity()` / `POST /sandbox/{id}/last-activity` resets the inactivity timer ([Update last activity](https://www.daytona.io/docs/en/sandboxes.md#update-sandbox-last-activity)).
- A race can still stop a sandbox right after a refresh **[community, source analysis]** ([#5154](https://github.com/daytonaio/daytona/issues/5154)).
- Daytona recommends archiving or stopping over delete-and-recreate, and webhooks over polling ([Limits: best practices](https://www.daytona.io/docs/en/limits.md#best-practices)).

---

## 3. Databases and services inside a sandbox

- **The entrypoint is supervised by the Daytona daemon:**
  - The runner makes the daemon the container entrypoint and passes the image ENTRYPOINT/CMD to it as arguments.
  - The daemon runs that command **asynchronously** in an internal "entrypoint session" ([container_configs.go](https://github.com/daytonaio/daytona/blob/v0.190.0/apps/runner/pkg/docker/container_configs.go), [daemon main.go](https://github.com/daytonaio/daytona/blob/v0.190.0/apps/daemon/cmd/daemon/main.go)).
  - Its logs are available via SDK `get_entrypoint_logs()` / `getEntrypointLogs()` ([Process: entrypoint session](https://www.daytona.io/docs/en/process-code-execution.md#entrypoint-session)).
  - A `sleep infinity` keep-alive is **no longer needed**: "the daemon is now long-running by default" ([#4273](https://github.com/daytonaio/daytona/issues/4273)). It is harmless.
- **No process manager is provided.** Nothing restarts a crashed postgres or redis. Each start runs the entrypoint again, because stop terminates the container ([Stop](https://www.daytona.io/docs/en/sandboxes.md#stop-sandboxes)). Make the entrypoint idempotent and make the app layer re-startable on demand.
- **Shutdown is short:**
  - The OSS runner stops the container with a **10 s** timeout and then kills it.
  - The daemon's session grace period defaults to **5 s** ([stop.go](https://github.com/daytonaio/daytona/blob/v0.190.0/apps/runner/pkg/docker/stop.go), [daemon config.go](https://github.com/daytonaio/daytona/blob/v0.190.0/apps/daemon/cmd/daemon/config/config.go)).
  - A daemonized Postgres may be SIGKILLed and do crash recovery on the next start.
  - Pre-stop hooks do not exist yet ([#2977](https://github.com/daytonaio/daytona/issues/2977)). To stop cleanly, run a stop command through exec before `sandbox.stop()`.
- **What survives what:**

  | Event | Files (incl. PG data dir) | Running processes / RAM (Redis without persistence) | Preview token |
  |---|---|---|---|
  | stop → start | kept | lost | **new token**; old ones invalid ([Preview](https://www.daytona.io/docs/en/preview.md#standard-preview-url)) |
  | archive → start | kept (restored from object storage) | lost | new |
  | VM pause → resume | kept | kept | kept |
  | delete | gone (volumes survive) | gone | n/a |

  Sources: [Persistence](https://www.daytona.io/docs/en/persistence.md) and [Sandbox lifecycle](https://www.daytona.io/docs/en/sandboxes.md#sandbox-lifecycle).
- **Background servers through Daytona's API:** run long-lived servers in a session with async commands. Daytona's Scale docs show a server in one session with work in another ([Scale: workload concurrency](https://www.daytona.io/docs/en/scale.md)). These still do not count as activity for auto-stop.

---

## 4. Preview URLs, ports, auth, HMR

- **URL format:** `https://{port}-{sandboxId}.{daytonaProxyDomain}` for any port 1–65535 ([Preview](https://www.daytona.io/docs/en/preview.md)).
  - Localhost-bound services are proxied too. That was fixed after [#1973](https://github.com/daytonaio/daytona/issues/1973).
  - Vite's host check then rejects the preview domain unless it is in `server.allowedHosts`, which allows `localhost`, `.localhost` and IPs by default ([Vite server.allowedHosts](https://vite.dev/config/server-options#server-allowedhosts), [#1973](https://github.com/daytonaio/daytona/issues/1973)).
- **Standard token:**
  - Sent in the `x-daytona-preview-token` header.
  - **Sandbox-wide, cannot be revoked**, and also authenticates ports 22222 (terminal), 2280 (Toolbox) and 33333 (recordings).
  - Changes on every stop/start ([Preview](https://www.daytona.io/docs/en/preview.md#standard-preview-url)).
- **Signed URL:** the token is in the URL, bound to one port, with an expiry from 60 s (default) to 24 h; 3600 s is recommended. It survives restarts and can be revoked ([Preview: signed](https://www.daytona.io/docs/en/preview.md#signed-preview-url)).
- **Public sandboxes:** with `public: true`, previews need no auth, but the reserved ports above still do ([Custom preview proxy: reserved ports](https://www.daytona.io/docs/en/custom-preview-proxy.md#reserved-ports)).
- **Browser warning page:**
  - Shown on first visit.
  - Skip it with `X-Daytona-Skip-Preview-Warning: true`, Tier 3, or a custom proxy ([Preview: warning](https://www.daytona.io/docs/en/preview.md#warning-page)).
  - Once accepted, it stays skipped for that URL for 24 h ([Custom preview proxy](https://www.daytona.io/docs/en/custom-preview-proxy.md)).
- **WebSockets:**
  - Supported by the proxy, and they skip the warning page ([Custom preview proxy](https://www.daytona.io/docs/en/custom-preview-proxy.md#websocket-support)).
  - On private sandboxes, unauthenticated WS upgrades are redirected to Auth0. A token in the query parameter `DAYTONA_SANDBOX_AUTH_KEY` works per a maintainer **[community]** ([#4117](https://github.com/daytonaio/daytona/issues/4117)).
  - Vite's HMR client falls back to a direct connection if the WS through the proxy fails. The fixes are proxying WS, or setting `server.ws.clientPort` / a different `server.ws.port` ([Vite server.ws](https://vite.dev/config/server-options#server-ws)).
- **Vite behind the preview proxy, known bugs [community]:**
  - 400 `"bad request: 404 Not Found"` after a few seconds of idle. The cause is the daemon reusing pooled keep-alive connections that Node closed after 5 s. The workaround is a Vite plugin setting `httpServer.keepAliveTimeout = 120000` ([#3846](https://github.com/daytonaio/daytona/issues/3846)).
  - The same symptom on refresh with signed URLs ([#3899](https://github.com/daytonaio/daytona/issues/3899)).
  - 504s on `.vite/deps` after edits ([#3348](https://github.com/daytonaio/daytona/issues/3348)).
- **Proxy behaviour:**
  - It appends its own host to `X-Forwarded-Host` unless a custom proxy sends `X-Daytona-Trust-Forwarded-Host` with a token.
  - The default CORS allows all origins with credentials; `X-Daytona-Disable-CORS: true` turns that off.
  - `X-Daytona-Skip-Last-Activity-Update: true` stops preview traffic from keeping a sandbox alive ([Custom preview proxy](https://www.daytona.io/docs/en/custom-preview-proxy.md)).
- **Custom domains:** run your own preview proxy, based on [daytona-proxy-samples](https://github.com/daytonaio/daytona-proxy-samples). It can also auto-start stopped sandboxes ([Custom preview proxy](https://www.daytona.io/docs/en/custom-preview-proxy.md)).

---

## 5. Pitfalls and limits people hit

- **Egress on Tier 1 and 2:**
  - Only "essential services" are reachable, and allow lists cannot override that ([Network limits](https://www.daytona.io/docs/en/network-limits.md#tier-based-network-restrictions)).
  - The list includes GitHub (`*.github.com`, `*.githubusercontent.com`), npm/nodesource, RubyGems, `*.ubuntu.com`, Anthropic/`claude.ai`, `playwright.dev`/`cdn.playwright.dev`, Google Fonts, Sentry and Linear.
  - It does **not** include, for example, `apt.postgresql.org`, Stripe or arbitrary SaaS APIs ([Essential services](https://www.daytona.io/docs/en/network-limits.md#essential-services); the live list is in [sandbox-network-whitelist](https://github.com/daytonaio/sandbox-network-whitelist)).
  - On Tier 3 and 4, a sandbox allow list *replaces* the default, so essential services must be listed explicitly.
- **Auto-stop mid-task:** long work without external interaction gets stopped (see §2). One community write-up also flags the 15-minute stop **[community]** ([Upstash blog](https://upstash.com/blog/how-background-coding-agents-keep-working)).
- **Sandbox loss under load:** sandboxes have disappeared mid-run with `failed to resolve container IP`. One reporter measured about 0.5% of runs across many runners **[community]** ([#5137](https://github.com/daytonaio/daytona/issues/5137)). Plan for retries and idempotent setup.
- **Snapshot inactivity:** snapshots deactivate after 2 weeks unused ([Snapshots](https://www.daytona.io/docs/en/snapshots.md#activate-snapshots)).
- **Regions:** the shared regions are `us` and `eu`; tier limits apply to the org's default region ([Regions](https://www.daytona.io/docs/en/regions.md), [Limits: tiers](https://www.daytona.io/docs/en/limits.md#tiers)). Snapshots are per region (`--region` on `snapshot create`) ([CLI](https://www.daytona.io/docs/en/tools/cli.md)).
- **CLI unit trap:** `daytona-v0 create --memory` is in **MB**, but `snapshot create --memory` is in **GB** ([CLI](https://www.daytona.io/docs/en/tools/cli.md)).
- **CLI rename:** `daytona` will become the v2 CLI. Scripts should call `daytona-v0`, or pin the Homebrew formula ([CLI](https://www.daytona.io/docs/en/tools/cli.md)).
- **Upstream repo frozen:** core development moved private in June 2026 ([README](https://github.com/daytonaio/daytona)). The issues above are still the best public record, but the source no longer tracks production.
- **Claude Code as root:** `--dangerously-skip-permissions` refuses to run as root/sudo **[community]** ([anthropics/claude-code#9184](https://github.com/anthropics/claude-code/issues/9184)). Run the agent as a non-root user.

---

## Recommendations for our setup

Compared against `README.md`, `Dockerfile`, `entrypoint.sh`, `stack/*` and `wizard.sh`. No files were changed.

### Already aligned
- **Native processes, no DinD.** This avoids the daemon overhead and the cgroup failure ([Snapshots: DinD](https://www.daytona.io/docs/en/snapshots.md#run-docker-in-a-sandbox), [#5146](https://github.com/daytonaio/daytona/issues/5146)).
- **Prebuilt Dockerfile snapshot with toolchains baked in, repos cloned per sandbox.** This matches the snapshot fan-out pattern ([Scale](https://www.daytona.io/docs/en/scale.md)). Blobless clones keep disk down.
- **Idempotent infra entrypoint.** It suits Daytona re-running the entrypoint on every start ([Stop](https://www.daytona.io/docs/en/sandboxes.md#stop-sandboxes), [daemon main.go](https://github.com/daytonaio/daytona/blob/v0.190.0/apps/daemon/cmd/daemon/main.go)).
- **Redis without persistence.** This fits "memory is cleared on every stop" ([Persistence](https://www.daytona.io/docs/en/persistence.md)).
- **Chromium from Playwright, with deps via `install-deps`, run by the `daytona` user.** Playwright adds `--no-sandbox` and `--disable-dev-shm-usage` itself ([chromium.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromium.ts), [chromiumSwitches.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromiumSwitches.ts)).
- **Caddy in front of Vite, with `header_up Host {upstream_hostport}`.**
  - Vite sees an IP host, which passes `allowedHosts` ([Vite](https://vite.dev/config/server-options#server-allowedhosts)).
  - Caddy proxies WebSockets, so HMR works.
  - Previewing port 80/443 instead of 3002/3006 should sidestep the Vite keep-alive 400 bug ([#3846](https://github.com/daytonaio/daytona/issues/3846)). Unverified; this assumes Caddy's idle timeout exceeds the daemon's pool TTL.
- **The wizard already uses `daytona-v0`** with a fallback ([CLI](https://www.daytona.io/docs/en/tools/cli.md)).
- **Puma in single mode, one Solid Queue process, `MALLOC_ARENA_MAX=2`.** Good for a no-swap cgroup ([container_configs.go](https://github.com/daytonaio/daytona/blob/v0.190.0/apps/runner/pkg/docker/container_configs.go)).

### Gaps and risks, with suggested changes
1. **Auto-stop will kill long agent runs.**
   - The orchestrator example passes no `--auto-stop`, so the 15-minute default applies. The smoke test uses 30.
   - Claude Code running as a background process does not reset the timer ([auto-stop](https://www.daytona.io/docs/en/sandboxes.md#auto-stop-interval)).
   - **Change:** either (a) drive Claude through a Toolbox session or SSH and call `refreshActivity()` on a heartbeat while the ticket is active ([last activity](https://www.daytona.io/docs/en/sandboxes.md#update-sandbox-last-activity)), or (b) create with `--auto-stop 0 --ttl <max ticket minutes>` ([TTL](https://www.daytona.io/docs/en/sandboxes.md#wall-clock-ttl)).
2. **App services are not restored after a restart.** The entrypoint brings infra back, but api, jobs and Vite stay down after any stop/start. `$STATE/pids` files may also point at dead or recycled PIDs.
   - **Change:** the orchestrator runs `bunny-stack up` after every `start`, or `bunny-stack status` checks ports. Optionally clear `$BUNNY_ROOT/.stack/pids` in the entrypoint ([Persistence](https://www.daytona.io/docs/en/persistence.md)).
3. **The ~15-minute first `bunny-stack up` (gems, npm, db:setup, seeds) is the dominant cold-start cost.**
   - **Change:** build a second-stage *cold snapshot from a prepared sandbox*. Create from the base snapshot, run `bunny-stack setup`, stop the stack and Postgres cleanly, stop the sandbox, then `create_snapshot` ([Snapshots: create from sandbox](https://www.daytona.io/docs/en/snapshots.md#create-snapshot-from-sandbox)).
   - Per ticket, only `git fetch`/checkout, `bundle check`, `npm ci` if the lockfile changed, and `db:migrate` remain.
   - Refresh it nightly. That also keeps it inside the 2-week activity window ([Activate snapshots](https://www.daytona.io/docs/en/snapshots.md#activate-snapshots)).
   - Remove any credential files before snapshotting.
4. **Check which user exec/SSH runs as.**
   - The Dockerfile ends with `USER root`. In OSS v0.190.0, the runner sets no container user, so the daemon and Toolbox commands would run as root ([container_configs.go](https://github.com/daytonaio/daytona/blob/v0.190.0/apps/runner/pkg/docker/container_configs.go)).
   - If hosted behaves the same, `bunny-stack up` via `daytona-v0 exec` resolves `BUNNY_ROOT` to `/root/bunny`, while `bunny-infra` expects `/home/daytona/bunny` for the kong cert.
   - Chrome DevTools MCP would also fail as root ([troubleshooting](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/troubleshooting.md)), as would Claude `--dangerously-skip-permissions` ([#9184](https://github.com/anthropics/claude-code/issues/9184)).
   - **Change:** run `daytona-v0 exec <sb> -- id` once. If it prints root, wrap agent commands in `sudo -iu daytona`, or set `--user daytona` at create ([CLI](https://www.daytona.io/docs/en/tools/cli.md)). The entrypoint needs root for postgres and caddy, so do not just flip the final `USER`.
5. **Disk and quota.**
   - 10 GiB per sandbox has to hold Ubuntu, Ruby, PG, Node, Chromium, gems, two `node_modules` trees, repos and the DB. Hitting the limit can brick the sandbox ([#2848](https://github.com/daytonaio/daytona/issues/2848)).
   - Stopped sandboxes hold quota until archived (default 7 days) ([Disk quota](https://www.daytona.io/docs/en/limits.md#disk-quota)).
   - **Change:**
     - Measure `df -h /` after `bunny-stack up`.
     - Create with `--auto-archive 60` or similar, and `--auto-delete` once the PR is merged or closed ([auto-archive](https://www.daytona.io/docs/en/sandboxes.md#auto-archive-sandboxes)).
     - Consider `playwright install --only-shell` if only headless runs are needed ([Playwright browsers](https://playwright.dev/docs/browsers#chromium-headless-shell)).
6. **Egress tier.** On Tier 1 or 2, anything the API or Vite apps call outside the essential list will fail at runtime ([Network limits](https://www.daytona.io/docs/en/network-limits.md#tier-based-network-restrictions)). `apt.postgresql.org` is not on the list, so runtime `apt install postgresql-*` would also fail; build time is unverified.
   - **Change:** list the app's runtime outbound hosts and check them against the [whitelist](https://github.com/daytonaio/sandbox-network-whitelist). Decide on Tier 3, or stub those services.
7. **`NODE_EXTRA_CA_CERTS` collision.** `bunny-stack` exports `NODE_EXTRA_CA_CERTS=/etc/bunny-stack/certs/...`. If you ever use `domainAllowList` or Secrets (which use the egress TLS proxy), Daytona points this variable at its CA bundle, and the override breaks Node egress ([HTTPS traffic](https://www.daytona.io/docs/en/network-limits.md#https-traffic)).
   - **Change:** build a combined bundle: the Daytona bundle if present, plus `bunny.internal.crt`.
8. **Chromium does not trust the dev cert.** `update-ca-certificates` covers curl and Ruby, not Chromium ([Chromium cert management](https://chromium.googlesource.com/chromium/src/+/main/docs/linux/cert_management.md)).
   - **Change:** in `bunny-infra` (or at first `up`), run `certutil -d sql:/home/daytona/.local/share/pki/nssdb -A -t "P,," -n bunny.internal -i <crt>` as `daytona`. This needs `libnss3-tools`, and `.pki/nssdb` if that path exists.
   - Otherwise standardise on `ignoreHTTPSErrors` / `--ignore-https-errors` / `--acceptInsecureCerts` in the agent's MCP config ([playwright-mcp](https://github.com/microsoft/playwright-mcp), [chrome-devtools-mcp config](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md)).
9. **Browser version drift.** The baked `npx playwright@1 install chromium` takes the latest 1.x at build time. A repo-pinned `@playwright/test` or a Playwright MCP version needs its *own* browser revision ([Playwright browsers](https://playwright.dev/docs/browsers)).
   - **Change:** pin the Playwright version in the Dockerfile to match the repos and MCP, or run `npx playwright install chromium` as part of `bunny-stack setup`.
   - If using Playwright MCP, configure `--headless --browser chromium --isolated` ([playwright-mcp README](https://github.com/microsoft/playwright-mcp)).
   - Make the wizard's "Chromium is installed" check actually launch headless Chromium against `https://bunny.bunny.internal/app`.
10. **Memory headroom.** Rails, jobs, two Vite servers, Postgres, Chromium and Claude Code run in a no-swap cgroup. An OOM is a hard kill ([container_configs.go](https://github.com/daytonaio/daytona/blob/v0.190.0/apps/runner/pkg/docker/container_configs.go), [#5137](https://github.com/daytonaio/daytona/issues/5137)).
    - **Change:** read `/sys/fs/cgroup/memory.peak` after a full E2E run ([Isolation](https://www.daytona.io/docs/en/isolation.md#runtime-isolation)). Size to that plus a margin; 8 GiB is the default per-sandbox maximum. Set Playwright `workers` explicitly, because `nproc` shows host cores.
11. **Tokens as plain env vars.** `CLAUDE_CODE_OAUTH_TOKEN` and `GH_TOKEN` are readable by anything in the sandbox.
    - **Change:** move them to Daytona Secrets with host allow lists: `api.github.com`/`github.com` for GH, and the Anthropic hosts for Claude. The proxy substitutes header and Basic-auth placeholders ([Secrets](https://www.daytona.io/docs/en/secrets.md)).
    - Caveats: the bundler `x-access-token:$GH_TOKEN` Basic-auth path and the Claude OAuth header both need testing. Secrets disqualify warm-pool claims ([Warm pools](https://www.daytona.io/docs/en/warm-pools.md)).
12. **Clean Postgres shutdown.** Stop gives about 10 s before SIGKILL ([stop.go](https://github.com/daytonaio/daytona/blob/v0.190.0/apps/runner/pkg/docker/stop.go)).
    - **Change:** the orchestrator runs `sudo bunny-infra stop` via exec before `stop`. This matters most before creating a snapshot from the sandbox (item 3).
13. **Human previews.** To let a reviewer open the app through a Daytona preview link, preview **port 80 (Caddy)** with a signed URL ([Preview](https://www.daytona.io/docs/en/preview.md#signed-preview-url)).
    - Check that the front-ends do not hard-code `http://localhost:3000` (`REACT_APP_API_URL` in `frontend_env`). In a reviewer's browser that points at their own machine.
    - Check that `whitelisted_origin` and Rails host checks accept the `*.proxy.daytona.works`-style host. Note that Daytona appends to `X-Forwarded-Host` ([Custom preview proxy](https://www.daytona.io/docs/en/custom-preview-proxy.md#preserve-x-forwarded-host)).
14. **Optional, bigger change: Linux VM class.** If cold start still matters after item 3: a VM sandbox with the stack running, captured as a **hot snapshot** (or forked per ticket), starts with processes already up. Auto-pause keeps them alive across idle ([Linux sandboxes](https://www.daytona.io/docs/en/linux-sandboxes.md), [Scale: fork](https://www.daytona.io/docs/en/scale.md)).
    - Costs: the image must come from a registry push or a sandbox snapshot, not `--dockerfile`. Preview traffic does not reset auto-pause.
    - Daytona v2 is built around this model ([v2 Snapshots](https://www.daytona.com/docs/snapshots.md)).
15. **Cosmetic.** `exec sleep infinity` in `entrypoint.sh` is no longer required ([#4273](https://github.com/daytonaio/daytona/issues/4273)). It is harmless, so no change is needed.

---

## Open questions / couldn't verify

- **`/dev/shm` size on hosted v0 runners.** The OSS source sets none, so Docker's 64 MB default would apply, but hosted may differ. Playwright and Puppeteer work around it anyway. Measure with `df -h /dev/shm`.
- **Which user Toolbox/exec/SSH commands run as** when the image's last `USER` is root, and whether `--user` at create changes it. This is inferred from v0.190.0 source only.
- **Whether the Daytona daemon (PID 1) reaps orphaned or zombie processes**, which matters for Chromium and esbuild children.
- **Whether snapshot *builds* are subject to the org's tier egress restrictions.** If they were, PGDG and nodesource fetches during the build would fail on Tier 1/2. The current snapshot built, which suggests they are not, but no doc says so.
- **How disk quota is computed:** does the image size count against the sandbox `--disk`, or only the writable layer?
- **Whether Caddy in front of Vite fully avoids the [#3846](https://github.com/daytonaio/daytona/issues/3846) pooled-connection 400s.** It depends on the daemon's pool TTL, which is undocumented.
- **Tier 1 RAM** is listed as both 10 GiB and 20 GiB on the [Limits](https://www.daytona.io/docs/en/limits.md) page.
- **The v0 deprecation timeline** is not published. The [upgrade guide](https://www.daytona.io/docs/en/upgrade-to-v2.md) calls v0 "the current platform".
- **No first-party Daytona guide** covers Playwright/Chrome DevTools MCP for E2E verification of a custom app, and no Daytona Discord summaries were accessible. The "what people do" evidence is GitHub issues plus a few third-party posts: [Encore](https://encore.dev/blog/encore-daytona-sandboxes) (DinD + Postgres), the [Daytona community post on background agents](https://www.daytona.io/dotfiles/background-agents-sdk-with-daytona) (clone at boot, keep tokens outside the sandbox), and [Upstash](https://upstash.com/blog/how-background-coding-agents-keep-working) (snapshot once, auto-stop caveat).
