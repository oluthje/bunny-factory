// Every 5 minutes: the backstop for runs Inngest has lost, such as when the Inngest dev server
// restarts mid-run. A lost run never reaches its own cleanup, onFailure or run-cancelled, so it
// would stay in flight forever, holding one of the poller's `maxRuns` slots and its sandbox.
// - A run in flight whose heartbeat (heartbeat.ts) is older than LOST_AFTER_MINUTES is closed as
//   failed: its sandbox deleted, the ticket told, and its labels moved on to human-needed.
// - A factory sandbox whose run this orchestrator has finished is deleted: a run's own delete failed.
// - Run folders on the data volume are pruned: older than 30 days, or oldest first while the volume
//   is short of space. Never a run in flight's, the mirrors or factory.db; SQLite rows are kept.
// It keeps running while the factory is stopped (`factory stop`).
// The pure decisions are `isLostRun`, `leftoverSandboxes` and `runFoldersToPrune` in logic.ts.
import { runsOpen, runStatuses } from "../db/index.ts";
import { deleteRunFolder, runFolders, volumeSpace } from "../disk.ts";
import { inngest } from "../inngest.ts";
import { isLostRun, leftoverSandboxes, runFoldersToPrune, sandboxName } from "../logic.ts";
import { deleteSandbox, listFactorySandboxes } from "../sandbox.ts";
import { finish } from "../task.ts";

/**
 * Longer than any quiet spell in a live run: Inngest calls it at least every few minutes (the
 * longest sleep is merge's 2-minute CI wait), and no single step takes near this long.
 */
const LOST_AFTER_MINUTES = 30;

export const sweepRuns = inngest.createFunction(
  { id: "sweep-runs", triggers: [{ cron: "*/5 * * * *" }], concurrency: { limit: 1 } },
  async ({ step }) => {
    const lost = await step.run("find-lost-runs", () =>
      runsOpen()
        .filter((r) => isLostRun(r, new Date(), LOST_AFTER_MINUTES))
        .map((r) => ({ id: r.id, ticketId: r.ticketId, identifier: r.ticketIdentifier, lastSeenAt: r.lastSeenAt })),
    );
    for (const run of lost) {
      await step.run(`close-${run.id}`, async () => {
        await deleteSandbox(sandboxName(run.identifier, run.id));
        await finish({
          runId: run.id,
          ticketId: run.ticketId,
          end: { status: "failed", next: "human" },
          text: `The orchestrator lost this run: nothing has driven it for over ${LOST_AFTER_MINUTES} minutes (last seen ${run.lastSeenAt ?? "never"}). Its runner was deleted.`,
          record: { error: `Lost: no heartbeat for ${LOST_AFTER_MINUTES} minutes.` },
        });
      });
    }

    const leftovers = await step.run("find-leftover-sandboxes", async () => {
      const sandboxes = await listFactorySandboxes();
      const statuses = runStatuses(sandboxes.flatMap((s) => (s.runId ? [s.runId] : [])));
      const ids = new Set(leftoverSandboxes(sandboxes, statuses));
      return sandboxes.filter((s) => ids.has(s.id)).map(({ id, name }) => ({ id, name }));
    });
    for (const sb of leftovers) {
      await step.run(`delete-${sb.name}`, () => deleteSandbox(sb.id));
    }

    const pruned = await step.run("prune-run-folders", async () => {
      const inFlight = new Set(runsOpen().map((r) => r.id));
      const ids = runFoldersToPrune(await runFolders(), inFlight, volumeSpace(), new Date());
      for (const id of ids) deleteRunFolder(id);
      return ids.length;
    });

    return { closed: lost.map((r) => r.identifier), deleted: leftovers.map((s) => s.name), pruned };
  },
);
