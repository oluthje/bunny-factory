// The release changes a QA run is given: per repo, what `production..<branch>` adds, one line per
// first-parent commit (a PR's merge or squash) with its PR and the tickets it names. They steer where
// the run looks; they never decide what it tests. Pure: no I/O, so it is unit-tested in release.test.ts.
import type { LoggedCommit } from "../../src/git.ts";

/** The branch releases ship from: the release changes are what the run's branch adds to it. */
export const RELEASED = "production";

/** The most commits listed per repo. */
export const MAX_COMMITS = 100;

/** One repo's release changes: null when it has no `production` branch, or not the run's branch. */
export type RepoChanges = { repo: string; changes: { commits: LoggedCommit[]; total: number } | null };

const TICKET = /\b[A-Z][A-Z0-9]+-\d+\b/g;

/** A commit's title: a merge commit's is its PR title, on the body's first line. */
function title(c: LoggedCommit): string {
  const merge = /^Merge pull request (#\d+) from \S+$/.exec(c.subject);
  if (!merge) return c.subject;
  const prTitle = c.body.split("\n", 1)[0]?.trim();
  return prTitle ? `${prTitle} (${merge[1]})` : c.subject;
}

function line(c: LoggedCommit): string {
  const t = title(c);
  const tickets = [...new Set(`${c.subject}\n${c.body}`.match(TICKET) ?? [])].filter((id) => !t.includes(id));
  return `- \`${c.sha.slice(0, 7)}\` ${t}${tickets.length ? ` · ${tickets.join(", ")}` : ""}`;
}

/** The release changes for the prompt. */
export function renderReleaseChanges(branch: string, repos: readonly RepoChanges[]): string {
  if (branch === RELEASED) return `None: the run tests \`${RELEASED}\` itself. This is a whole-area run.`;
  const sections = repos.flatMap(({ repo, changes }) => {
    if (!changes || changes.total === 0) return [];
    const more = changes.total - changes.commits.length;
    return [`### ${repo} (${changes.total} ${changes.total === 1 ? "commit" : "commits"})\n\n${changes.commits.map(line).join("\n")}${more > 0 ? `\n- … and ${more} older` : ""}`];
  });
  if (!sections.length) return `None: \`${branch}\` adds nothing to \`${RELEASED}\`. This is a whole-area run.`;
  return `What \`${branch}\` adds to \`${RELEASED}\`, newest first.\n\n${sections.join("\n\n")}`;
}
