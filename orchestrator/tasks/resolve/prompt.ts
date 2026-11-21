// resolve's placeholders in prompt.md: each open PR with why it needs the base merged in, and where
// to write the resolution. Pure: no I/O, so it is unit-tested in prompt.test.ts.
import { artifact } from "../../src/runner-paths.ts";

/** Where the agent writes how it resolved each conflict, or why it couldn't. */
export const RESOLUTION = artifact("resolution.md");

/** One open PR: its URL, and why it needs the base merged in, or null when GitHub sees nothing stale. */
export type StalePr = { repo: string; url: string; why: string | null };

export function promptVars(prs: readonly StalePr[]): Record<string, string> {
  return {
    resolutionPath: RESOLUTION,
    prs: prs.map((p) => `- ${p.repo}: ${p.url}: ${p.why ?? "GitHub shows no conflict now; merge the base in anyway, so it's up to date."}`).join("\n"),
  };
}
