// Every 5 minutes: each bulk branch's PR into main (src/bulk.ts). It opens a draft once a
// sub-ticket has merged into the branch, marks it ready and hands the parent to Oscar once every
// sub-ticket is closed, and when Oscar merges it, deletes the branch and closes the parent. A PR
// closed without merging abandons the batch: the branch goes, and the parent waits on Oscar. A
// branch nothing merged into goes once every sub-ticket is closed.
// Its neighbours: run-ticket.ts places sub-tickets' runs on the branch, and the merge task merges
// into it. Only the machine that starts runs, while the factory is running, sweeps.
import { batchStep, bulkParentOf, BULK_PREFIX } from "../bulk.ts";
import { config } from "../config.ts";
import { getFactoryState } from "../db/index.ts";
import { aheadBy, branchesWithPrefix, branchSha, deleteBranch, latestPr, markReady, openOrFindPr } from "../github.ts";
import { inngest } from "../inngest.ts";
import { HUMAN_NEEDED_LABEL } from "../labels.ts";
import { applyLabels, closeTicket, comment, openSubTickets, ticketByIdentifier } from "../linear.ts";
import { linearComment, markForGithub, mayStartRuns, prRef } from "../logic.ts";

export const bulkBatches = inngest.createFunction(
  { id: "bulk-batches", triggers: [{ cron: "*/5 * * * *" }], concurrency: { limit: 1 } },
  async ({ step }) => {
    const mayStart = await step.run("may-sweep", () => mayStartRuns(config.poll, getFactoryState().state));
    if (!mayStart) return { swept: false };

    // Every bulk branch, by parent, with its head and its PR into main. Read-only.
    const batches = await step.run("read-batches", async () => {
      const byParent: Record<string, { repo: string; branch: string; sha: string; pr: Awaited<ReturnType<typeof latestPr>>; ahead: number }[]> = {};
      for (const repo of config.repos) {
        for (const branch of await branchesWithPrefix(repo, BULK_PREFIX)) {
          const parent = bulkParentOf(branch);
          const sha = await branchSha(repo, branch);
          if (!parent || !sha) continue;
          (byParent[parent] ??= []).push({
            repo,
            branch,
            sha,
            pr: await latestPr(repo, branch, config.baseBranch),
            ahead: await aheadBy(repo, config.baseBranch, branch),
          });
        }
      }
      return byParent;
    });

    const swept: string[] = [];
    for (const [identifier, repos] of Object.entries(batches)) {
      // GitHub actions, each safe to repeat; what to say comes back for the report step.
      const acted = await step.run(`batch-${identifier}`, async () => {
        const parent = await ticketByIdentifier(identifier);
        if (!parent) return null;
        const open = await openSubTickets(parent.id);
        const steps = repos.map((r) => ({ ...r, next: batchStep({ pr: r.pr, branchSha: r.sha, aheadOfMain: r.ahead, subTicketsOpen: open }) }));
        const notes: string[] = [];
        for (const r of steps) {
          if (r.next === "open-draft") {
            const body = markForGithub(
              `The bulk batch of [${parent.identifier}](${parent.url}): its sub-tickets' PRs, each squashed into \`${r.branch}\` with no per-PR review. Review it as one PR.`,
            );
            const url = await openOrFindPr(r.repo, r.branch, `${parent.identifier}: ${parent.title} (bulk)`, body, config.baseBranch, true);
            notes.push(`Opened ${prRef(url)}, a draft of the batch so far into \`${config.baseBranch}\`.`);
          } else if (r.next === "mark-ready") {
            await markReady(r.pr!.url);
            notes.push(`Every sub-ticket is closed: ${prRef(r.pr!.url)} is ready for review.`);
          } else if (r.next === "close-out" || r.next === "abandon" || r.next === "delete-empty") {
            await deleteBranch(r.repo, r.branch);
          }
        }
        const abandoned = steps.filter((r) => r.next === "abandon").map((r) => prRef(r.pr!.url));
        if (abandoned.length) notes.push(`${abandoned.join(", ")} closed without merging: the batch is abandoned there, and its bulk branch deleted.`);
        // Done when every branch left merged; a branch deleted empty doesn't hold the batch open.
        const live = steps.filter((r) => r.next !== "delete-empty");
        const closeOut = live.length > 0 && live.every((r) => r.next === "close-out");
        return {
          parentId: parent.id,
          notes,
          closeOut: closeOut ? live.map((r) => prRef(r.pr!.url)) : null,
          waits: abandoned.length > 0 || steps.some((r) => r.next === "mark-ready"),
          summary: `${identifier}: ${steps.map((r) => `${r.repo} ${r.next}`).join(", ")}.`,
        };
      });
      if (!acted) {
        swept.push(`${identifier}: no such ticket; left alone.`);
        continue;
      }

      // The parent's comment and labels, a step of their own so a retried action doesn't post twice.
      await step.run(`report-${identifier}`, async () => {
        if (acted.closeOut) {
          await comment(acted.parentId, linearComment(`The batch merged into \`${config.baseBranch}\`: ${acted.closeOut.join(", ")}. Done.`, null));
          await closeTicket(acted.parentId);
          return;
        }
        if (!acted.notes.length) return;
        await comment(acted.parentId, linearComment(`${acted.notes.join("\n\n")}${acted.waits ? "\n\nWaiting on Oscar." : ""}`, null));
        if (acted.waits) await applyLabels(acted.parentId, { add: [HUMAN_NEEDED_LABEL], remove: [] });
      });
      swept.push(acted.summary);
    }
    return { swept: true, batches: swept };
  },
);
