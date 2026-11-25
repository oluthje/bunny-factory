// Test data for the qa task's tests: a result as the structured pass returns it, and Linear comments.
import type { ThreadedComment } from "../../src/linear.ts";
import { linearComment } from "../../src/logic.ts";
import type { Defect, Flow, QaResult } from "./result.ts";

export const flow = (over: Partial<Flow> = {}): Flow => ({
  name: "Guest checkout, card",
  interface: "UI",
  result: "passed",
  defect: null,
  blockedBy: null,
  evidence: [{ file: "checkout.png", note: "" }],
  knownAs: null,
  knownOutcome: null,
  knownNote: "",
  ...over,
});

export const defect = (over: Partial<Defect> = {}): Defect => ({
  title: "Refunding a paid invoice twice creates two credit notes",
  severity: "High",
  area: "Invoices › Refunds",
  steps: ["Log in as the seeded admin, open invoice INV-0012 (paid)", "Click Refund, confirm; click Refund again before the modal closes"],
  expected: "one credit note, second click ignored",
  actual: "two credit notes for the full amount",
  evidence: [{ file: "double-refund.webm", note: "" }, { file: "refund_twice_spec.rb", note: "fails: expected 1, got 2" }],
  where: ["api/app/services/refund_invoice.rb:41"],
  reproduced: "3/3",
  agentNotes: "",
  knownAs: null,
  ...over,
});

export const result = (over: Partial<QaResult> = {}): QaResult => ({ flows: [flow()], defects: [], suspects: [], ...over });

/** The pass's `claude --output-format json` output around a result. */
export const passOutput = (structured: unknown) => JSON.stringify({ subtype: "success", structured_output: structured });

let n = 0;
export const threaded = (body: string, over: Partial<ThreadedComment> = {}): ThreadedComment => {
  n++;
  return { id: `c${n}`, parentId: null, url: `https://linear.app/c${n}`, body, createdAt: `2026-11-2${n % 10}T10:00:00.000Z`, isMe: true, ...over };
};

export const factory = (text: string, tag?: string) => linearComment(text, "run-1", tag);
