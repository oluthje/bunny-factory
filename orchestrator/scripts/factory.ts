// The `factory` CLI's commands, run inside the Fly machine by `bin/factory` (over `fly ssh
// console`), so they work on the machine's SQLite directly. The root README.md documents them.
//
//   node scripts/factory.ts status | start | stop | stop --now
//
// - `start`: new runs start again (poll-linear and run-ticket check the state, factory_state).
// - `stop`: drains. No new run starts; a queued run with no runner yet ends cancelled and keeps its
//   task label (run-ticket, `may-start-runner`); runs that have a runner finish.
// - `stop --now`: also cancels every run in flight: its record closed, its Inngest run cancelled,
//   its runner deleted, and its ticket's task label put back (task.ts, `requeue`).
// The screen `status` prints is rendered by src/status.ts.
import { config } from "../src/config.ts";
import { closeIfOpen, getFactoryState, runsFinished, runsOpen, setFactoryState } from "../src/db/index.ts";
import { volumeSpace } from "../src/disk.ts";
import { inngest, RUN_STOP } from "../src/inngest.ts";
import { sandboxName } from "../src/logic.ts";
import { deleteSandbox, snapshotCreatedAt } from "../src/sandbox.ts";
import { renderStatus, type StatusInput } from "../src/status.ts";
import { requeue } from "../src/task.ts";

const USAGE = "Usage: factory status | start | stop | stop --now";

async function snapshot(): Promise<StatusInput["snapshot"]> {
  try {
    const name = config.snapshot();
    return { name, createdAt: await snapshotCreatedAt(name) };
  } catch (err) {
    return { error: `couldn't read the snapshot: ${(err as Error).message}` };
  }
}

async function status(): Promise<void> {
  const { state, lastPolledAt } = getFactoryState();
  console.log(
    renderStatus({
      now: new Date(),
      state,
      polling: config.poll === "on",
      deploy: config.deploy,
      maxRuns: config.maxRuns,
      inFlight: runsOpen()
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((r) => ({ ticket: r.ticketIdentifier, task: r.task, step: r.currentStep, createdAt: r.createdAt })),
      recent: runsFinished(10).map((r) => ({
        ticket: r.ticketIdentifier,
        task: r.task,
        status: r.status,
        createdAt: r.createdAt,
        finishedAt: r.finishedAt!,
        prUrls: r.prUrls,
      })),
      lastPolledAt,
      disk: volumeSpace(),
      patExpires: config.patExpires,
      snapshot: await snapshot(),
    }),
  );
}

/**
 * Cancels every run in flight. The record is closed first, so run-cancelled, which the
 * cancellation triggers, finds it closed and leaves its labels to `requeue`.
 */
async function stopNow(): Promise<void> {
  const open = runsOpen();
  for (const run of open) {
    try {
      closeIfOpen(run.id, "cancelled");
      await inngest.send({ name: RUN_STOP, data: { runId: run.id } });
      await deleteSandbox(sandboxName(run.ticketIdentifier, run.id));
      await requeue({ runId: run.id, ticketId: run.ticketId, text: "The run was cancelled by `factory stop --now`. Its runner was deleted." });
      console.log(`Cancelled ${run.ticketIdentifier} (${run.task}): runner deleted, task label put back.`);
    } catch (err) {
      process.exitCode = 1;
      console.error(`Couldn't finish cancelling ${run.ticketIdentifier} (run ${run.id}): ${(err as Error).message}`);
    }
  }
  if (open.length === 0) console.log("No runs were in flight.");
}

const [command, ...flags] = process.argv.slice(2);
const now = flags.length === 1 && flags[0] === "--now";

if (command === "status" && flags.length === 0) {
  await status();
} else if (command === "start" && flags.length === 0) {
  setFactoryState("running");
  console.log("Started: new runs start on the next poll.");
  if (config.poll !== "on") console.log("⚠ FACTORY_POLL isn't `on` on this machine, so it still starts none.");
} else if (command === "stop" && (flags.length === 0 || now)) {
  setFactoryState("stopped");
  if (now) {
    await stopNow();
  } else {
    const left = runsOpen().length;
    console.log(
      `Stopping: no new runs start. ${left} run${left === 1 ? "" : "s"} in flight: those with a runner finish, ` +
        "queued ones end cancelled and keep their task label. `factory status` shows what's left.",
    );
  }
} else {
  console.error(USAGE);
  process.exitCode = 2;
}
