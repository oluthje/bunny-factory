// Pure logic: no I/O, so it is unit-tested in test/logic.test.ts.

export type Ticket = {
  id: string;
  identifier: string;
  title: string;
  description: string;
  url: string;
  branchName: string;
  labels: string[];
  updatedAt: string;
};

export type ChangedRepo = { repo: string; commits: number };

/** Every Linear comment the factory posts carries this marker, so pollers can skip them. */
export const COMMENT_MARKER = "🏭 oscar-factory";

/**
 * Everything the factory posts on GitHub carries this marker. The factory posts as Oscar (the
 * PAT's owner), so the author alone can't tell Oscar's own comments from the factory's.
 */
export const GITHUB_MARKER = "<!-- oscar-factory -->";

export function markForGithub(body: string): string {
  return `${body.trimEnd()}\n\n${GITHUB_MARKER}`;
}

/** Posted by the factory: the marker, or the footer of a PR body or review from before it. */
export function isFactoryGithubBody(body: string): boolean {
  return body.includes(GITHUB_MARKER) || /(?:Opened|Posted) by Oscar's factory/.test(body);
}

/** Tickets on this page the poller may start a run on, without duplicates. `busy` holds a ticket back. */
export function selectNewTickets(issues: Ticket[], busy: (ticket: Ticket) => boolean): Ticket[] {
  const seen = new Set<string>();
  return issues.filter((t) => {
    if (seen.has(t.id) || busy(t)) return false;
    seen.add(t.id);
    return true;
  });
}

/** The newest `updatedAt` seen so far. ISO-8601 strings in UTC sort as text. */
export function advanceCursor(prev: string | null, issues: Ticket[]): string | null {
  return issues.reduce<string | null>((max, t) => (max === null || t.updatedAt > max ? t.updatedAt : max), prev);
}

export function sandboxName(identifier: string, runId: string): string {
  return `oscar-factory-${identifier}-${runId.slice(0, 8)}`.toLowerCase();
}

export function shQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

/**
 * Daytona runs commands as root. Run them as the `daytona` user in a login shell instead:
 * `-E` keeps Daytona's proxy and CA variables and the Secret placeholder, and the login shell
 * adds ~/.local/bin (claude) and the NO_PROXY profile script.
 */
export function asDaytona(cmd: string): string {
  return `sudo -E -u daytona -H bash -lc ${shQuote(`cd ~ && ${cmd}`)}`;
}

/** Parses `<repo> <new commit count>` lines from the sandbox. */
export function parseChangedRepos(stdout: string): ChangedRepo[] {
  return stdout
    .split("\n")
    .map((line) => /^([a-z][\w-]*) (\d+)$/.exec(line.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ repo: m[1]!, commits: Number(m[2]) }))
    .filter((r) => r.commits > 0);
}

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

/** The agent's review, framed for a PR comment with the ticket link and run id. */
export function reviewComment(t: Ticket, review: string, runId: string): string {
  return markForGithub([
    `Factory review of [${t.identifier}](${t.url}).`,
    "",
    review.trim(),
    "",
    "---",
    `Posted by Oscar's factory (run \`${runId}\`). Its fixes are pushed as commits; the rest are comments, with no approval or change request.`,
  ].join("\n"));
}

/** A factory comment for Linear: the marker, the run it's about if any, then the text. */
export function linearComment(text: string, runId: string | null): string {
  return `${runId ? `${COMMENT_MARKER} · run \`${runId}\`` : COMMENT_MARKER}\n\n${text}`;
}

export function isFactoryComment(body: string): boolean {
  return body.startsWith(COMMENT_MARKER);
}

/** An evidence image in the agent's PR body: `![alt](evidence/<file>)`, relative or absolute. */
const EVIDENCE_IMAGE = /!\[([^\]]*)\]\((?:\S*\/)?evidence\/([^)\s]+)\)/g;

export type EvidenceRef = { alt: string; file: string };

/** Evidence files the PR body references, each once, in order. */
export function evidenceRefs(body: string): EvidenceRef[] {
  const seen = new Set<string>();
  return [...body.matchAll(EVIDENCE_IMAGE)].flatMap(([, alt, file]) => {
    if (seen.has(file!)) return [];
    seen.add(file!);
    return [{ alt: alt!, file: file! }];
  });
}

/**
 * Evidence images become links to their uploaded URLs: GitHub can't show Linear-hosted media
 * inline, so a labelled link beats a broken image. A file with no URL is marked as not captured.
 */
export function linkEvidence(body: string, urls: Record<string, string>): string {
  return body.replace(EVIDENCE_IMAGE, (_, alt: string, file: string) => {
    const url = urls[file];
    if (!url) return `${alt} _(not captured)_`;
    const icon = /\.(gif|webm|mp4|mov)$/i.test(file) ? "▶" : "🖼";
    return `[${icon} ${alt}](${url})`;
  });
}
