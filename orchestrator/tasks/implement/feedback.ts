// Feedback for an `implement` run that updates an existing PR: Oscar's unresolved review threads,
// PR comments and ticket comments, rendered as what to change this round. The ticket stays the spec.
// Pure: no I/O, so it is unit-tested in feedback.test.ts.
import { dated, quote, type PrComment, type ReviewThread, type ThreadComment, type TicketComment } from "../../src/comments.ts";
import { isFactoryComment, isFactoryGithubBody } from "../../src/logic.ts";

/** Oscar has the last word, unresolved: a thread waiting on the factory. */
export function threadsWaitingOnFactory(threads: readonly ReviewThread[], viewer: string): ReviewThread[] {
  return threads.filter((t) => {
    const last = t.comments.at(-1);
    return !t.isResolved && last !== undefined && last.author === viewer && !isFactoryGithubBody(last.body);
  });
}

export type Feedback = {
  markdown: string;
  /** The handle the agent answers by (`T1`) → the thread's node id. */
  handles: Record<string, string>;
  /** Whether there is anything new: threads, PR comments or ticket comments since the last run. */
  any: boolean;
};

const newerThan = (since: string | null) => (c: { createdAt: string }) => since === null || c.createdAt > since;

/**
 * The feedback section of the prompt. `since` is when the ticket's previous run finished: PR and
 * ticket comments after it are new; earlier ticket comments are context. Threads count while
 * they wait on the factory, however old.
 */
export function renderFeedback(args: {
  threads: readonly ReviewThread[];
  prComments: readonly PrComment[];
  ticketComments: readonly TicketComment[];
  since: string | null;
  viewer: string;
}): Feedback {
  const { since, viewer } = args;
  const who = (c: ThreadComment) => (isFactoryGithubBody(c.body) ? "Factory" : c.author === viewer ? "Oscar" : c.author);

  const threads = threadsWaitingOnFactory(args.threads, viewer);
  const handles: Record<string, string> = {};
  const threadBlocks = threads.map((t, i) => {
    const handle = `T${i + 1}`;
    handles[handle] = t.id;
    const where = t.line === null ? `${t.repo}/${t.path} (outdated: the line has since changed)` : `${t.repo}/${t.path}:${t.line}`;
    const turns = t.comments.map((c) => `**${who(c)}:**\n\n${quote(c.body)}`).join("\n\n");
    return `#### ${handle}: \`${where}\`\n\n${turns}`;
  });

  const prComments = args.prComments.filter(
    (c) => c.author === viewer && !isFactoryGithubBody(c.body) && newerThan(since)(c),
  );
  const mine = args.ticketComments.filter((c) => c.isMe && !isFactoryComment(c.body));
  const fresh = mine.filter(newerThan(since));
  const earlier = mine.filter((c) => !newerThan(since)(c));

  const sections = [
    threadBlocks.length ? `### Review threads\n\n${threadBlocks.join("\n\n")}` : null,
    prComments.length ? `### PR comments\n\n${prComments.map((c) => dated(c, `${c.repo}, `)).join("\n\n")}` : null,
    fresh.length ? `### Ticket comments\n\n${fresh.map((c) => dated(c)).join("\n\n")}` : null,
  ].filter((s): s is string => s !== null);
  const any = sections.length > 0;
  if (!any) sections.push("None: no thread waits on the factory, and there are no new PR or ticket comments.");
  if (earlier.length) {
    sections.push(`### Earlier ticket comments\n\nContext only: earlier runs handled these.\n\n${earlier.map((c) => dated(c)).join("\n\n")}`);
  }
  return { markdown: sections.join("\n\n"), handles, any };
}
