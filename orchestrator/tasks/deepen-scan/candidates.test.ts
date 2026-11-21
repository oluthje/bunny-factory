import { describe, expect, it } from "vitest";
import { CANDIDATE_CAP, candidateTicket, parseScanResult, renderEarlier, scanReport, toFile, type Candidate } from "./candidates.ts";

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  title: "Invoice totals",
  strength: "Strong",
  summary: "One module owns how an invoice adds up.",
  body: "**Strength:** Strong\n\n### Files\n\napi/app/models/invoice.rb",
  ...over,
});
const result = (candidates: Candidate[]) => JSON.stringify({ structured_output: { candidates } });

describe("parseScanResult", () => {
  it("reads the candidates", () => {
    const weak = candidate({ title: "Mailer layout", strength: "Speculative", body: "" });
    expect(parseScanResult(result([candidate(), weak]))).toEqual({ ok: true, candidates: [candidate(), weak] });
  });

  it("accepts a scan that found nothing", () => {
    expect(parseScanResult(result([]))).toEqual({ ok: true, candidates: [] });
  });

  it("refuses a Strong candidate with no body: its ticket would be empty", () => {
    const r = parseScanResult(result([candidate({ body: " " })]));
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toContain('"Invoice totals"');
  });

  it("refuses an unknown strength, and an empty result", () => {
    expect(parseScanResult(result([{ ...candidate(), strength: "Maybe" } as unknown as Candidate]))).toMatchObject({ ok: false });
    expect(parseScanResult("", "boom")).toEqual({ ok: false, error: "The candidates pass wrote no result: boom" });
  });
});

describe("toFile", () => {
  it("keeps the Strong candidates, in order, up to the cap", () => {
    const all = [
      candidate({ title: "A" }),
      candidate({ title: "B", strength: "Worth exploring" }),
      candidate({ title: "C" }),
      candidate({ title: "D" }),
      candidate({ title: "E" }),
    ];
    expect(CANDIDATE_CAP).toBe(3);
    expect(toFile(all).map((c) => c.title)).toEqual(["A", "C", "D"]);
  });
});

describe("candidateTicket", () => {
  it("makes the candidate's section the description, and links back to the scan", () => {
    const t = candidateTicket(candidate(), { identifier: "REC-9", url: "https://linear.app/x/REC-9" });
    expect(t.title).toBe("Deepen: Invoice totals");
    expect(t.description.startsWith("**Strength:** Strong")).toBe(true);
    expect(t.description).toContain("[REC-9](https://linear.app/x/REC-9)");
  });
});

describe("renderEarlier", () => {
  it("says so when there are none", () => {
    expect(renderEarlier([])).toBe("None: this is the first scan.");
  });

  it("gives each candidate's fate, the refuter's verdict and Oscar's reason for turning one down", () => {
    const out = renderEarlier([
      { identifier: "REC-1", title: "Deepen: Invoice totals", state: "open", recommendation: { verdict: "not yet", why: "Wait for a second adapter." }, rejection: null },
      { identifier: "REC-2", title: "Deepen: Mailer layout", state: "cancelled", recommendation: null, rejection: "We're replacing the mailers.\nNot worth it." },
    ]);
    expect(out).toContain("- **Invoice totals** (REC-1, open)\n  The refuter said `not yet`: Wait for a second adapter.");
    expect(out).toContain("- **Mailer layout** (REC-2, turned down by Oscar)\n  Oscar's reason:\n  > We're replacing the mailers.\n  > Not worth it.");
  });
});

describe("scanReport", () => {
  const filed = [{ identifier: "REC-10", url: "https://linear.app/x/REC-10" }];

  it("lists every candidate, links the filed ones and the report, and folds the full text", () => {
    const out = scanReport({
      candidates: [candidate(), candidate({ title: "Mailer layout", strength: "Speculative", body: "" })],
      filed,
      reportUrl: "https://uploads.linear.app/r.html",
      markdown: "## Invoice totals\n\n…",
    });
    expect(out).toContain("Scanned: 2 candidates, 1 strong. Filed 1, each queued for `deepen-refute`.");
    expect(out).toContain("- **Strong** · Invoice totals → [REC-10](https://linear.app/x/REC-10): One module owns");
    expect(out).toContain("- **Speculative** · Mailer layout: One module owns");
    expect(out).toContain("(https://uploads.linear.app/r.html)");
    expect(out).toContain("+++ All candidates\n\n## Invoice totals");
  });

  it("marks a Strong candidate past the cap as having no ticket", () => {
    const out = scanReport({ candidates: [candidate(), candidate({ title: "Second" })], filed, reportUrl: null, markdown: "x" });
    expect(out).toContain("- **Strong** · Second (over the cap of 3: no ticket)");
    expect(out).not.toContain("📄");
  });

  it("says when nothing was strong", () => {
    const out = scanReport({ candidates: [candidate({ strength: "Worth exploring", body: "" })], filed: [], reportUrl: null, markdown: "x" });
    expect(out).toContain("Scanned: 1 candidate, none strong. No ticket filed.");
  });
});
