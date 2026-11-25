// What `fac status` prints (scripts/factory.ts): the factory's state, its runs in flight, the
// last finished runs and the health checks, on one screen. Pure: the script gathers the input from
// SQLite, the volume and Daytona; this only renders it. Unit-tested in test/status.test.ts.
import type { RunRow } from "./db/index.ts";
import { DAY_MS as DAY, DISK_LOW, factoryMode, plural, type FactoryState, type VolumeSpace } from "./logic.ts";

export type StatusInput = {
  now: Date;
  state: FactoryState;
  /** Whether this machine picks tickets up at all: FACTORY_POLL is `on`. */
  polling: boolean;
  /** The commit this image was built from, and when it was deployed; null for a local checkout. */
  deploy: { commit: string | null; at: string | null };
  maxRuns: number;
  inFlight: { ticket: string; task: string; step: string | null; createdAt: string }[];
  /** The last finished runs, newest first. */
  recent: { ticket: string; task: string; status: RunRow["status"]; createdAt: string; finishedAt: string; prUrls: string[] | null }[];
  /** When pick-up-tickets last fetched tickets from Linear. */
  lastPolledAt: string | null;
  disk: VolumeSpace;
  /** The day the GitHub PAT expires, `YYYY-MM-DD`. */
  patExpires: string;
  snapshot: { name: string; createdAt: string } | { error: string };
};

/**
 * Linear unchecked for longer than this, while the factory runs, is a warning: the backstop
 * (pick-up-tickets.ts) checks every 10 minutes even when no webhook arrives.
 */
const POLL_STALE_MINUTES = 15;
/** A snapshot older than this should be rebuilt (docs/services.md, "Rebuild policy"). */
const SNAPSHOT_STALE_DAYS = 7;
/** Warn this many days before the PAT expires. */
const PAT_WARN_DAYS = 7;

const WARN = "⚠ ";
const GB = 1024 ** 3;

/** A span as `45s`, `12m`, `1h 15m`, `2h`, `2d 4h` or `3d`. */
function span(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return `${Math.max(0, Math.floor(ms / 1000))}s`;
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  return h % 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${Math.floor(h / 24)}d`;
}

const since = (now: Date, iso: string) => now.getTime() - Date.parse(iso);

/** Rows padded into columns. */
function table(rows: string[][]): string[] {
  const widths = rows.reduce<number[]>((w, r) => r.map((c, i) => Math.max(w[i] ?? 0, c.length)), []);
  return rows.map((r) => `  ${r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]!))).join("  ")}`.trimEnd());
}

function stateLine(input: StatusInput): string {
  const mode = factoryMode(input.state, input.inFlight.length);
  const shown = mode === "draining" ? `draining (${plural(input.inFlight.length, "run")} left)` : mode;
  const { commit, at } = input.deploy;
  const deployed = commit ? `deployed ${commit.slice(0, 7)}${at ? ` ${span(since(input.now, at))} ago (${at.slice(0, 16).replace("T", " ")} UTC)` : ""}` : "not a deploy";
  return `State      ${shown} · ${deployed}`;
}

function healthLines(input: StatusInput): string[] {
  const { now } = input;
  const linear = !input.polling
    ? "not checked: FACTORY_POLL isn't on here"
    : input.state === "stopped"
      ? "not checked: the factory is stopped"
      : input.lastPolledAt === null
        ? `${WARN}never checked`
        : `${since(now, input.lastPolledAt) > POLL_STALE_MINUTES * 60_000 ? WARN : ""}last checked ${span(since(now, input.lastPolledAt))} ago`;

  const { total, free } = input.disk;
  const used = `${((total - free) / GB).toFixed(1)} of ${(total / GB).toFixed(1)} GB used (${Math.round(((total - free) / total) * 100)}%)`;
  const disk = free < total * DISK_LOW ? `${WARN}${used}: under ${Math.round(DISK_LOW * 100)}% free, more than sweep-runs can free` : used;

  const patDays = Math.ceil((Date.parse(`${input.patExpires}T00:00:00Z`) - now.getTime()) / DAY);
  const pat = `${patDays <= PAT_WARN_DAYS ? WARN : ""}${patDays < 0 ? `expired ${-patDays} days ago` : `expires in ${patDays} days`} (${input.patExpires})`;

  const snap = input.snapshot;
  const snapshot =
    "error" in snap
      ? `${WARN}${snap.error}`
      : (() => {
          const days = Math.floor(since(now, snap.createdAt) / DAY);
          return `${days > SNAPSHOT_STALE_DAYS ? WARN : ""}${snap.name}, ${plural(days, "day")} old`;
        })();

  return table([
    ["Linear", linear],
    ["Disk", disk],
    ["GitHub PAT", pat],
    ["Snapshot", snapshot],
  ]);
}

export function renderStatus(input: StatusInput): string {
  const { now } = input;
  const inFlight = input.inFlight.length
    ? table(input.inFlight.map((r) => [r.ticket, r.task, r.step ?? "queued", span(since(now, r.createdAt))]))
    : ["  none"];
  const recent = input.recent.length
    ? table(
        input.recent.map((r) => [
          r.ticket,
          r.task,
          r.status,
          span(Date.parse(r.finishedAt) - Date.parse(r.createdAt)),
          (r.prUrls ?? []).join(" "),
        ]),
      )
    : ["  none"];
  return [
    stateLine(input),
    "",
    `In flight  ${input.inFlight.length} of ${input.maxRuns}`,
    ...inFlight,
    "",
    "Recent",
    ...recent,
    "",
    "Health",
    ...healthLines(input),
  ].join("\n");
}
