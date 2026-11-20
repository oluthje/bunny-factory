// What the merge run says on the ticket and the PRs, for each way it can end: not merging and why,
// a dry run's "would merge", merged, or a partial merge to finish by hand. Pure: no I/O, so it is
// unit-tested in report.test.ts.
import type { CiState } from "../../src/checks.ts";
import { markForGithub, prRef, type Ticket } from "../../src/logic.ts";
import type { PrVerdict } from "./verdict.ts";

type Urls = Record<string, string>;
const refs = (repos: readonly string[], urls: Urls) => repos.map((r) => prRef(urls[r]!)).join(", then ");

/** The run stopped before the agent because CI didn't go green. */
export function ciStopText(ci: CiState, waitedMinutes: number): string {
  return ci.state === "red"
    ? `Not merging: CI failed: ${ci.failing.join(", ")}.`
    : `Not merging: CI was still running after ${waitedMinutes} minutes: ${ci.pending.join(", ")}.`;
}

/** The agent held a PR back, or the orchestrator's checks did. */
export function notMergingText(args: { summary: string; holdouts: readonly PrVerdict[]; blockers: readonly string[]; urls: Urls }): string {
  const { summary, holdouts, blockers, urls } = args;
  const lines = [...holdouts.map((h) => `- ${prRef(urls[h.repo]!)}: ${h.reason}`), ...blockers.map((b) => `- ${b}`)];
  return [`Not merging. ${summary}`, "", ...lines].join("\n");
}

export function wouldMergeText(summary: string, order: readonly string[], urls: Urls): string {
  return `🤖 Dry run: would auto-merge ${refs(order, urls)}. ${summary}\n\nMerging is off (\`FACTORY_MERGE_DRY_RUN\`), so nothing merged.`;
}

export function mergedText(summary: string, order: readonly string[], urls: Urls): string {
  return `Auto-merged ${refs(order, urls)}. ${summary}`;
}

/** A merge failed after others went in: they can't be undone, so a human finishes. */
export function partialText(args: { merged: readonly string[]; failed: { repo: string; error: string }; rest: readonly string[]; urls: Urls }): string {
  const { merged, failed, rest, urls } = args;
  return [
    merged.length ? "⚠️ Partial auto-merge:" : "⚠️ Auto-merge failed:",
    merged.length ? `${merged.map((r) => prRef(urls[r]!)).join(", ")} merged;` : "nothing merged;",
    `${prRef(urls[failed.repo]!)} NOT merged: ${failed.error.trim().replace(/[^.!?]$/, "$&.")}`,
    rest.length ? `Not tried: ${rest.map((r) => prRef(urls[r]!)).join(", ")}.` : null,
    "Finish by hand.",
  ]
    .filter((s): s is string => s !== null)
    .join(" ");
}

/** The ticket's text, framed for a comment on one of its PRs. */
export function prNote(t: Ticket, text: string, runId: string): string {
  return markForGithub(`Factory merge check of [${t.identifier}](${t.url}) (run \`${runId}\`).\n\n${text}`);
}
