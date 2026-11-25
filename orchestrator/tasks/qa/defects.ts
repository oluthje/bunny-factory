// Defects as the qa task posts them on Linear, and reads them back as known defects: one comment per
// defect, tagged `qa defect`, headed `**QA-4 · High · Invoices › Refunds**`, with a reply in its thread
// each time a later run checks it again. The QA verdict sweep reads the same comments, so this module
// is qa's contract with it. Pure: no I/O, so it is unit-tested in defects.test.ts.
import type { ThreadedComment } from "../../src/linear.ts";
import { commentText, hasCommentTag } from "../../src/logic.ts";

/** The tag on a defect comment's marker line. */
export const DEFECT_TAG = "qa defect";
/** The tag on a run's reply to a known defect: it still reproduces, or no longer does. */
export const RECHECK_TAG = "qa recheck";

export const SEVERITIES = ["Blocker", "High", "Medium", "Low"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** The opening of a recheck reply that closes a known defect: later runs stop matching against it. */
export const NO_LONGER_REPRODUCES = "No longer reproduces";

/** A defect comment's head line: number, severity and area. */
const HEAD = /^\*\*QA-(\d+) · (Blocker|High|Medium|Low) · (.+)\*\*$/m;

/** A defect as the comment carries it. `text` is the comment without its marker line or agent notes. */
export type PostedDefect = { number: number; severity: Severity; area: string; title: string; text: string };

/** The defect in a factory comment tagged `qa defect`, or null for any other comment. */
export function parseDefect(body: string): PostedDefect | null {
  if (!hasCommentTag(body, DEFECT_TAG)) return null;
  const text = commentText(body);
  const head = HEAD.exec(text);
  if (!head) return null;
  const notes = text.search(/^\+\+\+ Agent notes$/m);
  return {
    number: Number(head[1]),
    severity: head[2] as Severity,
    area: head[3]!,
    title: text.slice(head.index + head[0].length).trimStart().split("\n", 1)[0]!.trim(),
    text: (notes === -1 ? text : text.slice(0, notes)).trim(),
  };
}

/** The number the run's first new defect gets on this ticket: one past the highest posted so far. */
export function nextDefectNumber(comments: readonly ThreadedComment[]): number {
  return Math.max(0, ...comments.map((c) => parseDefect(c.body)?.number ?? 0)) + 1;
}

/** How a defect is referred to: `REC-201 #4` for defect 4 on REC-201. A bug ticket goes by its id. */
export const defectRef = (identifier: string, number: number) => `${identifier} #${number}`;

/** A defect the run matches its failures against, and where a recheck reply goes. */
export type KnownDefect = {
  ref: string;
  /** The ticket to post the recheck on. */
  ticketId: string;
  /** The defect comment to reply under; null for a bug ticket, which gets a comment of its own. */
  commentId: string | null;
  url: string;
  title: string;
  /** What the prompt shows: the steps, expected and actual, as written. */
  text: string;
};

/**
 * The defects posted on one ticket that are still open: every one whose latest recheck reply, if
 * any, doesn't say it no longer reproduces.
 */
export function openDefects(ticket: { id: string; identifier: string }, comments: readonly ThreadedComment[]): KnownDefect[] {
  return comments.flatMap((c) => {
    const defect = c.parentId === null ? parseDefect(c.body) : null;
    if (!defect) return [];
    const recheck = comments.filter((r) => r.parentId === c.id && hasCommentTag(r.body, RECHECK_TAG)).at(-1);
    if (recheck && commentText(recheck.body).startsWith(NO_LONGER_REPRODUCES)) return [];
    return [{ ref: defectRef(ticket.identifier, defect.number), ticketId: ticket.id, commentId: c.id, url: c.url, title: defect.title, text: defect.text }];
  });
}

/** An open bug ticket as a known defect: its description is its steps, expected and actual. */
export function bugDefect(bug: { id: string; identifier: string; title: string; url: string; description: string }): KnownDefect {
  return { ref: bug.identifier, ticketId: bug.id, commentId: null, url: bug.url, title: bug.title, text: bug.description.trim() || "(no description)" };
}

/** The known defects for the prompt, each under its reference. */
export function renderKnownDefects(known: readonly KnownDefect[]): string {
  if (!known.length) return "None.";
  return known.map((k) => `<known-defect ref="${k.ref}" title="${k.title.replaceAll('"', "'")}">\n${k.text}\n</known-defect>`).join("\n\n");
}
