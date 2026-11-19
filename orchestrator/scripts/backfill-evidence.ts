// Publishes a finished run's evidence and fixes its PRs' links: for runs made before the run
// function published evidence itself. Rewrites only the evidence links in each PR's current body.
//
//   node --env-file=../.env scripts/backfill-evidence.ts REC-8780 [REC-8778 ...]
import fs from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { config } from "../src/config.ts";
import { db, runs } from "../src/db/index.ts";
import { publishEvidence } from "../src/evidence.ts";
import { getPrBody, setPrBody } from "../src/github.ts";
import { comment } from "../src/linear.ts";
import { evidenceRefs, linearComment, linkEvidence } from "../src/logic.ts";

for (const identifier of process.argv.slice(2)) {
  const run = db.select().from(runs).where(eq(runs.ticketIdentifier, identifier)).orderBy(desc(runs.createdAt)).get();
  if (!run?.prUrls?.length) {
    console.log(`${identifier}: no run with a PR`);
    continue;
  }
  const runDir = path.join(config.dataDir, "runs", run.id);
  const agentBody = fs.readFileSync(path.join(runDir, "pr-body.md"), "utf8");
  const evidence = await publishEvidence(runDir, agentBody);
  const missing = evidenceRefs(agentBody).filter((r) => !evidence.urls[r.file]).map((r) => r.file);
  console.log(`${identifier}: uploaded ${Object.keys(evidence.urls).length} file(s)${missing.length ? `, missing ${missing.join(", ")}` : ""}`);

  for (const url of run.prUrls) {
    const current = await getPrBody(url);
    const next = linkEvidence(current, evidence.urls);
    if (next === current) {
      console.log(`  ${url}: no evidence links to fix`);
      continue;
    }
    await setPrBody(url, next);
    console.log(`  ${url}: evidence links updated`);
  }
  if (evidence.linearMarkdown) {
    await comment(run.ticketId, linearComment(evidence.linearMarkdown, run.id));
    console.log(`  ${identifier}: evidence posted on the ticket`);
  }
}
