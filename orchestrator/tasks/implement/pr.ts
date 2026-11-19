// The PR the factory opens or updates for an implement run: its title, and the agent's body framed
// with the ticket link and run id. Pure: no I/O, so it is unit-tested in pr.test.ts.
import { markForGithub, type Ticket } from "../../src/logic.ts";

export function prTitle(t: Ticket): string {
  return `${t.identifier}: ${t.title}`;
}

/** The agent's PR body (from the `pr` skill), framed with the ticket link and run id. */
export function prBody(t: Ticket, agentBody: string, runId: string): string {
  return markForGithub([
    `Implements [${t.identifier}](${t.url}).`,
    "",
    agentBody.trim() || "_The agent wrote no PR body._",
    "",
    "---",
    `Opened by Oscar's factory (run \`${runId}\`). Needs a human review before merging.`,
  ].join("\n"));
}
