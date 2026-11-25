// The qa-plan run's structured pass and the comment it becomes: the QA scopes it proposes, each
// numbered and folded, which Oscar has accepted, and what only a human can test. The zod schema is
// the one place the shape lives; each QA scope's description is qa's (tasks/qa/scope.ts).
// Pure: no I/O, so it is unit-tested in proposals.test.ts.
import { z } from "zod/v4";
import type { TicketComment } from "../../src/comments.ts";
import type { FiledTicket } from "../../src/linear.ts";
import { hasCommentTag, isFactoryComment } from "../../src/logic.ts";
import { parseStructuredOutput, structuredRetryPrompt, toCliJsonSchema } from "../../src/structured.ts";
import { renderScope, scopeTitle } from "../qa/scope.ts";

/** The tag on the proposals comment's marker line: a later qa-plan run and the QA verdict read it. */
export const PROPOSALS_TAG = "qa-plan proposals";

const scopeSchema = z.strictObject({
  number: z.number().int().min(1).describe("The QA scope's number. Keep the number an earlier proposal gave it."),
  area: z.string().min(1).describe("The product area, in a few words, such as `Portal checkout`. Unique: it names the filed ticket."),
  interface: z.enum(["UI", "API", "UI and API"]),
  flows: z.array(z.string().min(1)).min(1).describe("Every flow in the area, one per item: each belongs to exactly one QA scope."),
  releaseChanges: z.array(z.string()).describe('The release changes in this area, each as `api#1234 "Title" (REC-88)`. Empty when none.'),
  ownedElsewhere: z
    .array(z.strictObject({ what: z.string().min(1), owner: z.number().int().min(1).describe("The number of the QA scope that owns it.") }))
    .describe("Neighbouring flows another QA scope owns, so parallel runs don't cover the same ground."),
  accepted: z.boolean().describe("True only when Oscar has accepted this QA scope in a reply. Always false on a first run."),
});

export const proposalsSchema = z
  .strictObject({
    scopes: z.array(scopeSchema).min(1).describe("Every QA scope still proposed or accepted, in number order. One Oscar dropped is left out."),
    needsHuman: z.array(z.string().min(1)).describe("Flows that sit entirely behind a runner gap, which no QA scope proposes."),
  })
  .describe("The QA scopes, as written in the proposals.");

export type Proposals = z.infer<typeof proposalsSchema>;
export type Scope = Proposals["scopes"][number];

/** The JSON Schema handed to `claude --json-schema`. */
export const proposalsJsonSchema = (): string => toCliJsonSchema(proposalsSchema);

/** What the schema can't say: numbers and areas unique, owners real, and nothing accepted before Oscar has replied. */
function problems(p: Proposals, oscarReplied: boolean): string[] {
  const out: string[] = [];
  const numbers = p.scopes.map((s) => s.number);
  const areas = p.scopes.map((s) => s.area.toLowerCase());
  numbers.forEach((n, i) => numbers.indexOf(n) !== i && out.push(`Number ${n} is used twice.`));
  areas.forEach((a, i) => areas.indexOf(a) !== i && out.push(`Area \`${p.scopes[i]!.area}\` is used twice: each QA scope is filed under its area.`));
  const flows = p.scopes.flatMap((s) => s.flows.map((f) => ({ flow: f.toLowerCase(), scope: s.number })));
  for (const [i, f] of flows.entries()) {
    const first = flows.findIndex((g) => g.flow === f.flow);
    if (first !== i) out.push(`Flow \`${p.scopes.find((s) => s.number === f.scope)!.flows.find((x) => x.toLowerCase() === f.flow)}\` is in QA scopes ${flows[first]!.scope} and ${f.scope}: each flow belongs to exactly one.`);
  }
  for (const s of p.scopes) {
    for (const o of s.ownedElsewhere) {
      if (o.owner === s.number || !numbers.includes(o.owner)) out.push(`QA scope ${s.number}: \`${o.what}\` is owned by ${o.owner}, which isn't another QA scope.`);
    }
    if (s.accepted && !oscarReplied) out.push(`QA scope ${s.number} is accepted, but Oscar hasn't replied to any proposals yet.`);
  }
  return out;
}

/** The proposals from the pass's `claude --output-format json` output, validated again here. */
export function parseProposals(resultJson: string, oscarReplied: boolean, stderr = ""): { ok: true; proposals: Proposals } | { ok: false; error: string } {
  const parsed = parseStructuredOutput(resultJson, proposalsSchema, { pass: "The proposals pass", noun: "proposals" }, stderr);
  if (!parsed.ok) return parsed;
  const found = problems(parsed.value, oscarReplied);
  return found.length ? { ok: false, error: `The proposals don't add up:\n${found.map((f) => `- ${f}`).join("\n")}` } : { ok: true, proposals: parsed.value };
}

export function proposalsRetryPrompt(error: string): string {
  return structuredRetryPrompt(error, "Answer again with the QA scopes your proposals give, in the same structure.");
}

/** The QA scopes filed so far, by area in lower case, cancelled ones too: none is filed twice. */
export type Filed = Record<string, FiledTicket & { cancelled: boolean }>;

/** The filed ticket of a QA scope, matched by its area whatever the case. */
export const filedAs = (s: { area: string }, filed: Filed) => filed[s.area.toLowerCase()];

/** The filed sub-tickets, by area: a sub-ticket whose title is a QA scope's. */
export function filedByArea(p: Proposals, children: readonly (FiledTicket & { title: string; state: string })[]): Filed {
  return Object.fromEntries(
    p.scopes.flatMap((s) => {
      const t = children.find((c) => c.title.toLowerCase() === scopeTitle(s.area).toLowerCase());
      return t ? [[s.area.toLowerCase(), { id: t.id, identifier: t.identifier, url: t.url, cancelled: t.state === "cancelled" }]] : [];
    }),
  );
}

/** The QA scopes to file now: accepted, and not filed already. */
export const toFile = (p: Proposals, filed: Filed): Scope[] => p.scopes.filter((s) => s.accepted && !filedAs(s, filed));

/**
 * A QA scope's description, each owner named by its title, and by its ticket when that is filed
 * already: a ticket filed later doesn't rewrite the descriptions filed before it.
 */
export function scopeDescription(s: Scope, p: Proposals, branch: string, filed: Filed): string {
  const owner = (n: number) => {
    const o = p.scopes.find((x) => x.number === n)!;
    const ticket = filedAs(o, filed);
    return ticket ? `${scopeTitle(o.area)} (${ticket.identifier})` : scopeTitle(o.area);
  };
  return renderScope({
    branch,
    area: s.area,
    interface: s.interface,
    flows: s.flows,
    releaseChanges: s.releaseChanges,
    ownedElsewhere: s.ownedElsewhere.map((o) => ({ what: o.what, owner: owner(o.owner) })),
  });
}

/** The proposals comment: each QA scope folded under its number and title, filed ones linked, then what needs a human. */
export function renderProposals(p: Proposals, branch: string, filed: Filed, written: string): string {
  const filedCount = p.scopes.filter((s) => filedAs(s, filed)).length;
  const head = `**QA scopes** for \`${branch}\`: ${p.scopes.length} proposed, ${filedCount} filed.`;
  const folds = p.scopes.map((s) => {
    const ticket = filedAs(s, filed);
    if (!ticket) return `+++ ${s.number}. ${scopeTitle(s.area)}\n\n${scopeDescription(s, p, branch, filed)}\n\n+++`;
    // A filed QA scope lives on its ticket: change it there.
    const state = ticket.cancelled ? "cancelled" : "filed";
    return `+++ ${s.number}. ${scopeTitle(s.area)} · ${state} as ${ticket.identifier}\n\n[${ticket.identifier}](${ticket.url}): its description is the QA scope now.\n\n+++`;
  });
  const needsHuman = `**Needs a human**\n\n${p.needsHuman.length ? p.needsHuman.map((n) => `- ${n}`).join("\n") : "None."}`;
  const ask = "Reply with what to accept, change or drop, such as “Accept 1, 2, 4. Drop 3. For 2 also cover coupon stacking”, then add `oscar-factory:qa-plan` again.";
  // The proposals as the agent wrote them carry its Decisions and Gaps.
  return [head, ...folds, needsHuman, ask, `+++ Run notes: the proposals as written\n\n${written.trim()}\n\n+++`].join("\n\n");
}

/** Oscar's own comment: his, and not one the factory posted as him. */
const isOscars = (c: TicketComment) => c.isMe && !isFactoryComment(c.body);

/**
 * The latest proposals comment, and every reply of Oscar's since the first: what he accepted in an
 * earlier round still holds.
 */
export function latestProposals(comments: readonly TicketComment[]): { proposals: TicketComment; replies: TicketComment[] } | null {
  const first = comments.findIndex((c) => hasCommentTag(c.body, PROPOSALS_TAG));
  if (first === -1) return null;
  const at = comments.findLastIndex((c) => hasCommentTag(c.body, PROPOSALS_TAG));
  return { proposals: comments[at]!, replies: comments.slice(first + 1).filter(isOscars) };
}

/** Whether Oscar has replied to any proposals yet: until then, nothing can be accepted. */
export const oscarReplied = (comments: readonly TicketComment[]): boolean => (latestProposals(comments)?.replies.length ?? 0) > 0;

/** The **Needs a human** list in a proposals comment's text, for the QA verdict to repeat. */
export function needsHumanOf(text: string): string[] {
  const at = text.indexOf("**Needs a human**");
  if (at === -1) return [];
  const after = text.slice(at + "**Needs a human**".length).trimStart();
  return after.split("\n\n", 1)[0]!.split("\n").flatMap((l) => (l.startsWith("- ") ? [l.slice(2)] : []));
}
