// The `fac` CLI's commands, run inside the Fly machine by `bin/fac` (over `fly ssh
// console`), so they work on the machine's SQLite directly. The root README.md documents them.
//
//   node scripts/factory.ts status | start | stop | stop --now | deepen [direction]
//
// - `start`: new runs start again (poll-linear and run-ticket check the state, factory_state).
// - `stop`: drains. No new run starts; a queued run with no runner yet ends cancelled and keeps its
//   task label (run-ticket, `may-start-runner`); runs that have a runner finish.
// - `stop --now`: also cancels every run in flight: its record closed, its Inngest run cancelled,
//   its runner deleted, and its ticket's task label put back (task.ts, `requeue`).
// - `deepen`: files a deepen-scan ticket, the one its clock files (tasks/deepen-scan/ticket.ts), with
//   the rest of the line as the direction to look in. The poller starts the run from its label.
// The screen `status` prints is rendered by src/status.ts.
import { config } from "../src/config.ts";
import { closeIfOpen, getFactoryState, runsFinished, runsOpen, setFactoryState } from "../src/db/index.ts";
import { volumeSpace } from "../src/disk.ts";
import { inngest, RUN_STOP } from "../src/inngest.ts";
import { taskLabel } from "../src/labels.ts";
import { createTicket } from "../src/linear.ts";
import { plural, sandboxName } from "../src/logic.ts";
import { deleteSandbox, snapshotCreatedAt } from "../src/sandbox.ts";
import { renderStatus, type StatusInput } from "../src/status.ts";
import { requeue } from "../src/task.ts";
import { scanTicket } from "../tasks/deepen-scan/ticket.ts";

const USAGE = "Usage: fac status | start | stop | stop --now | deepen [direction]";

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
      await requeue({ runId: run.id, ticketId: run.ticketId, text: "The run was cancelled by `fac stop --now`. Its runner was deleted." });
      console.log(`Cancelled ${run.ticketIdentifier} (${run.task}): runner deleted, task label put back.`);
    } catch (err) {
      process.exitCode = 1;
      console.error(`Couldn't finish cancelling ${run.ticketIdentifier} (run ${run.id}): ${(err as Error).message}`);
    }
  }
  if (open.length === 0) console.log("No runs were in flight.");
}

/** Files a deepen-scan ticket now, whatever the clock's throttle says: Oscar asked for this one. */
async function deepen(direction: string): Promise<void> {
  const filed = await createTicket({ ...scanTicket(new Date(), config.timeZone, direction), labels: [taskLabel("deepen-scan")] });
  console.log(`Filed ${filed.identifier}: ${filed.url}`);
  const { state } = getFactoryState();
  if (config.poll !== "on" || state !== "running") console.log("⚠ The factory isn't starting runs now: the scan starts after `fac start`.");
  else console.log("The scan starts on the next poll.");
}

const [command, ...flags] = process.argv.slice(2);
const immediate = flags.length === 1 && flags[0] === "--now";

if (command === "status" && flags.length === 0) {
  await status();
} else if (command === "deepen") {
  await deepen(flags.join(" "));
} else if (command === "start" && flags.length === 0) {
  setFactoryState("running");
  console.log("Started: new runs start on the next poll.");
  if (config.poll !== "on") console.log("⚠ FACTORY_POLL isn't `on` on this machine, so it still starts none.");
} else if (command === "stop" && (flags.length === 0 || immediate)) {
  setFactoryState("stopped");
  if (immediate) {
    await stopNow();
  } else {
    const left = runsOpen().length;
    console.log(
      `Stopping: no new runs start. ${plural(left, "run")} in flight: those with a runner finish, ` +
        "queued ones end cancelled and keep their task label. `fac status` shows what's left.",
    );
  }
} else {
  console.error(USAGE);
  process.exitCode = 2;
}
