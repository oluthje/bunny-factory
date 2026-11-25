// CI on a commit, as the git host reports it: check runs and commit statuses, read by github.ts,
// summed up here as green, pending or red. Pure: no I/O, so it is unit-tested in test/checks.test.ts.

/** A check run, the latest of its name on the commit. `conclusion` is null until it completes. */
export type CheckRun = { name: string; status: string; conclusion: string | null };
/** A commit status (the older API some integrations still use): `success`, `pending`, `failure` or `error`. */
export type CommitStatus = { context: string; state: string };

export type CiState = {
  state: "green" | "pending" | "red";
  /** The checks that failed, by name. */
  failing: string[];
  /** The checks still running, by name. */
  pending: string[];
  /** How many checks there were: green with none is green only because nothing ran. */
  checks: number;
};

/**
 * A check that failed on a commit, with what the git host says about why: a check run's own
 * summary, and for a GitHub Actions job its raw log; a commit status has only its description.
 */
export type FailedCheck = { name: string; url: string | null; summary: string; log: string | null };

/** A completed check run with one of these didn't fail. */
export const PASSED = ["success", "skipped", "neutral"];

/**
 * CI on one commit. Red when any check failed, even with others still running; pending while any
 * is still running; green otherwise, including when there are no checks at all.
 */
export function ciState({ runs, statuses }: { runs: CheckRun[]; statuses: CommitStatus[] }): CiState {
  const failing = [
    ...runs.filter((r) => r.status === "completed" && !PASSED.includes(r.conclusion ?? "")).map((r) => r.name),
    ...statuses.filter((s) => s.state === "failure" || s.state === "error").map((s) => s.context),
  ];
  const pending = [
    ...runs.filter((r) => r.status !== "completed").map((r) => r.name),
    ...statuses.filter((s) => s.state === "pending").map((s) => s.context),
  ];
  return summarize(failing, pending, runs.length + statuses.length);
}

/** CI across several commits, such as each PR on a ticket: red beats pending beats green. */
export const combineCi = (states: CiState[]): CiState =>
  summarize(
    states.flatMap((s) => s.failing),
    states.flatMap((s) => s.pending),
    states.reduce((n, s) => n + s.checks, 0),
  );

function summarize(failing: string[], pending: string[], checks: number): CiState {
  return { state: failing.length ? "red" : pending.length ? "pending" : "green", failing, pending, checks };
}
