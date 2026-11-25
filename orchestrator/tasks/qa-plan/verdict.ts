// The QA verdict on a qa-plan ticket, once every filed QA scope has finished: go, go with caveats or
// no-go, by rule from the defects' severities after Oscar's regrades, with a duplicate pair counted
// once at the graver severity. It reads what the qa runs posted (tasks/qa/defects.ts and report.ts)
// and the proposals' Needs a human. Pure: no I/O, so it is unit-tested in verdict.test.ts.
import { createHash } from "node:crypto";
import type { ThreadedComment } from "../../src/linear.ts";
import { commentText, hasCommentTag, isFactoryComment } from "../../src/logic.ts";
import { DEFECT_TAG, duplicateOf, graver, NO_LONGER_REPRODUCES, parseDefect, RECHECK_TAG, regradeOf, type Severity, SEVERITIES, defectRef } from "../qa/defects.ts";
import { COVERAGE_TAG, type Coverage, parseCoverage } from "../qa/report.ts";

/** The tag on the QA verdict's marker line: the last one is compared before posting another. */
export const VERDICT_TAG = "qa verdict";

export type Verdict = "go" | "go with caveats" | "no-go";

/** A defect the QA verdict counts, with its severity after any regrade. */
export type Counted = { ref: string; url: string; title: string; severity: Severity; scope: string; duplicateOf: string | null };

/** A filed QA scope, as the QA verdict sees it. */
export type ScopeState = { identifier: string; title: string; url: string; finished: boolean; coverage: Coverage | null };

const isOscars = (c: ThreadedComment) => c.isMe && !isFactoryComment(c.body);

/** Oscar's latest answer of a kind in a comment's thread. */
function latestInThread<T>(comments: readonly ThreadedComment[], top: ThreadedComment, read: (text: string) => T | null): T | null {
  return comments.filter((c) => c.parentId === top.id && isOscars(c)).map((c) => read(c.body)).filter((x): x is T => x !== null).at(-1) ?? null;
}

/**
 * The coverage of the ticket's last run, or null when that run posted none (it failed, or is still
 * going) or none has run. Every run ends with one top-level report naming its run; a qa run's is its
 * coverage, so a later run that failed hides an earlier coverage.
 */
export function lastRunCoverage(comments: readonly ThreadedComment[]): Coverage | null {
  const report = comments.filter((c) => c.parentId === null && isRunReport(c.body)).at(-1);
  return report && hasCommentTag(report.body, COVERAGE_TAG) ? parseCoverage(commentText(report.body)) : null;
}

/** A run's own report: a factory comment naming its run, and not one of its defects. */
const isRunReport = (body: string) => isFactoryComment(body) && body.split("\n", 1)[0]!.includes(" · run `") && !hasCommentTag(body, DEFECT_TAG);

/**
 * Each defect once per QA scope: a defect the scope's later run met again as a known one counts at
 * that run's severity (unless regraded), in place of the one it was posted with.
 */
export function perScope(posted: readonly Counted[], known: readonly Counted[]): Counted[] {
  const byRef = new Map(posted.map((d) => [d.ref, d]));
  for (const k of known) byRef.set(k.ref, { ...byRef.get(k.ref), ...k, title: k.title || byRef.get(k.ref)?.title || "" });
  return [...byRef.values()];
}

/**
 * The defects posted on one ticket that still count: each with Oscar's latest regrade and
 * duplicate mark from its thread, without the ones a later run found gone.
 */
export function postedDefects(ticket: { identifier: string }, scope: string, comments: readonly ThreadedComment[]): Counted[] {
  return comments.flatMap((top) => {
    const d = top.parentId === null ? parseDefect(top.body) : null;
    if (!d) return [];
    const recheck = comments.filter((r) => r.parentId === top.id && hasCommentTag(r.body, RECHECK_TAG)).at(-1);
    if (recheck && commentText(recheck.body).startsWith(NO_LONGER_REPRODUCES)) return [];
    return [
      {
        ref: defectRef(ticket.identifier, d.number),
        url: top.url,
        title: d.title,
        severity: latestInThread(comments, top, regradeOf) ?? d.severity,
        scope,
        duplicateOf: latestInThread(comments, top, duplicateOf),
      },
    ];
  });
}

/**
 * A known defect a QA scope's run found still reproducing: at the severity that run gave it, unless
 * Oscar regraded it in its own thread (`thread` is the ticket a QA defect was posted on; null for a
 * bug ticket, which has no thread to regrade in).
 */
export function knownCounted(k: Coverage["known"][number], scope: string, thread: { identifier: string; comments: readonly ThreadedComment[] } | null): Counted {
  const posted = thread ? postedDefects(thread, scope, thread.comments).find((d) => d.ref === k.ref) : undefined;
  const top = posted ? thread!.comments.find((c) => c.url === posted.url) : undefined;
  const regraded = top ? latestInThread(thread!.comments, top, regradeOf) : null;
  return { ref: k.ref, url: k.url, title: posted?.title ?? "", severity: regraded ?? k.severity, scope, duplicateOf: posted?.duplicateOf ?? null };
}

/** Each defect once: a duplicate pair (or chain) becomes its first member, at the gravest severity. */
export function countOnce(defects: readonly Counted[]): Counted[] {
  const byRef = new Map(defects.map((d) => [d.ref, d]));
  // Follow the duplicate marks to the end; a loop (A of B, B of A) ends at its smallest reference.
  const root = (d: Counted): Counted => {
    const seen: Counted[] = [];
    let at: Counted | undefined = d;
    while (at && !seen.includes(at)) {
      seen.push(at);
      at = at.duplicateOf ? byRef.get(at.duplicateOf) : undefined;
    }
    if (!at) return seen.at(-1)!;
    const loop = seen.slice(seen.indexOf(at));
    return loop.reduce((min, x) => (x.ref < min.ref ? x : min));
  };
  const groups = new Map<string, Counted>();
  for (const d of defects) {
    const r = root(d);
    const g = groups.get(r.ref);
    groups.set(r.ref, { ...r, severity: graver(g?.severity ?? r.severity, d.severity) });
  }
  return [...groups.values()];
}

/** The rule: no-go on any Blocker, go with caveats on any High, otherwise go. */
export function verdictOf(defects: readonly Counted[]): Verdict {
  if (defects.some((d) => d.severity === "Blocker")) return "no-go";
  if (defects.some((d) => d.severity === "High")) return "go with caveats";
  return "go";
}

/** The fingerprint line that ends a QA verdict: a short hash of the rest, which Linear may reformat. */
const FINGERPRINT = /^_Fingerprint `([0-9a-f]{12})`_$/m;

/** The fingerprint of a posted QA verdict's text, or null. */
export const fingerprintOf = (text: string): string | null => FINGERPRINT.exec(text)?.[1] ?? null;

/** The QA verdict's text. Only called once every QA scope has finished, so each has its coverage. */
export function renderVerdict(args: { scopes: readonly ScopeState[]; defects: readonly Counted[]; needsHuman: readonly string[] }): string {
  const { scopes, defects, needsHuman } = args;
  const once = countOnce(defects);
  const verdict = verdictOf(once);
  const branch = scopes.find((s) => s.coverage)?.coverage!.branch ?? "unknown";
  const tally = SEVERITIES.map((s) => `${once.filter((d) => d.severity === s).length} ${s}`).join(", ");

  const bySeverity = (scope: string, s: Severity) => defects.filter((d) => d.scope === scope && d.severity === s).length;
  const table = [
    "| QA scope | Passed | Blocker | High | Medium | Low | Blocked | Not reached |",
    "|---|---|---|---|---|---|---|---|",
    ...scopes.map((s) => {
      const c = s.coverage!;
      return `| [${s.identifier}](${s.url}) ${s.title} | ${c.passed}/${c.flows} | ${SEVERITIES.map((sev) => bySeverity(s.identifier, sev)).join(" | ")} | ${c.blocked} | ${c.notReached} |`;
    }),
  ].join("\n");

  const grave = once.filter((d) => d.severity === "Blocker" || d.severity === "High");
  const commits = [...new Set(scopes.map((s) => s.coverage!.commits))];
  const human = [...needsHuman, ...scopes.flatMap((s) => s.coverage!.blockedFlows.map((b) => `${b.flow} (${s.identifier}): blocked, ${b.gap}`))];

  const body = [
    `**QA verdict: ${verdict}** · \`${branch}\``,
    `${tally}: each defect once, after Oscar's regrades.`,
    table,
    ...(grave.length ? [`**Blockers and Highs**\n\n${grave.map((d) => `- **${d.severity}** [${d.ref}](${d.url})${d.title ? ` ${d.title}` : ""}`).join("\n")}`] : []),
    commits.length === 1
      ? `**Commits tested:** ${commits[0]}`
      : `**Commits tested**\n\n${scopes.map((s) => `- ${s.identifier}: ${s.coverage!.commits}`).join("\n")}`,
    `**Needs a human**\n\n${human.length ? human.map((h) => `- ${h}`).join("\n") : "None."}`,
  ].join("\n\n");
  // Posted again only when this changes: a regrade, a duplicate mark, a QA scope run again.
  return `${body}\n\n_Fingerprint \`${createHash("sha256").update(body).digest("hex").slice(0, 12)}\`_`;
}
