// Comments the factory reads from Linear and GitHub, and how a prompt quotes them. Pure: no I/O.
// linear.ts and github.ts fetch these shapes; tasks render them into their prompts.
import { GITHUB_MARKER } from "./logic.ts";

export type TicketComment = { body: string; createdAt: string; isMe: boolean };
export type ThreadComment = { author: string; body: string; createdAt: string };
export type ReviewThread = {
  /** GitHub's node id, used to reply. */
  id: string;
  repo: string;
  path: string;
  /** Null when the thread is outdated and GitHub no longer maps it onto the head. */
  line: number | null;
  isResolved: boolean;
  comments: ThreadComment[];
};
export type PrComment = { repo: string; author: string; body: string; createdAt: string };

/** A comment quoted for a prompt, without the factory's hidden GitHub marker. */
export function quote(body: string): string {
  return body
    .replaceAll(GITHUB_MARKER, "")
    .trim()
    .split("\n")
    .map((l) => `> ${l}`.trimEnd())
    .join("\n");
}

/** A comment quoted under its date (`2026-11-18:`), after an optional prefix such as its repo. */
export function dated(c: { createdAt: string; body: string }, prefix = ""): string {
  return `${prefix}${c.createdAt.slice(0, 10)}:\n\n${quote(c.body)}`;
}
