// One run: a ticket in; for `implement`, one PR per changed repo out; for `review`, a review
// of the ticket's existing branch posted on the ticket and its PRs. Ports runner/sandbox.sh into Inngest steps.
// Every step is short; the long parts (catch-up, Claude) run in background sessions that we poll.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "../config.ts";
import { recordRun, ticketHasRun, updateRun } from "../db/index.ts";
import { publishEvidence } from "../evidence.ts";
import { branchDiff, bundleBase, fetchBranch, importAndPush, refreshMirror } from "../git.ts";
import { commitIdentity, findOpenPr, openOrFindPr, postReview } from "../github.ts";
import { inngest, RUN_REQUESTED } from "../inngest.ts";
import { comment, setInProgress } from "../linear.ts";
import {
  linearComment,
  linkEvidence,
  parseChangedRepos,
  prBody,
  prTitle,
  reviewComment,
  sandboxName,
  shQuote,
  type Ticket,
} from "../logic.ts";
import {
  ARTIFACTS,
  RUN_DIR,
  createSandbox,
  deleteSandbox,
  download,
  exitCodeOf,
  getSandbox,
  sh,
  startBackground,
  upload,
} from "../sandbox.ts";
import { buildPrompt, SKILLS_DIR, TASKS_DIR } from "../prompt.ts";
import {
  diffLines,
  EXTRACT_RETRIES,
  extractionRetryPrompt,
  parseReviewComments,
  parseVerdict,
  placeComments,
  reviewCommentsJsonSchema,
  verdictLine,
} from "../review.ts";
import { skillsFor, type TaskName } from "../tasks.ts";

const EVIDENCE_DIR = `${ARTIFACTS}/evidence`;
const PR_BODY = `${ARTIFACTS}/pr-body.md`;
const REVIEW = `${ARTIFACTS}/review.md`;
/** The extraction pass's `claude --output-format json` result, holding the inline comments. */
const REVIEW_COMMENTS = `${ARTIFACTS}/review-comments.json`;
/** How long the extraction pass may take: it only answers from the session, with no tools. */
const EXTRACT_TIMEOUT_SECONDS = 600;

/** Playwright MCP, pointed at the snapshot's Chromium. Screenshots and videos land in the evidence dir; `devtools` adds the video tools. */
const MCP_CONFIG = {
  mcpServers: {
    playwright: {
      command: "npx",
      args: [
        "-y", "@playwright/mcp@latest", "--headless", "--browser", "chromium",
        "--executable-path", "/home/daytona/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome",
        "--isolated", "--output-dir", EVIDENCE_DIR, "--viewport-size", "1440,900", "--caps", "devtools",
      ],
    },
  },
};

const runDirFor = (runId: string) => path.join(config.dataDir, "runs", runId);

type RunRequested = { runId: string; ticket: Ticket; task: TaskName };

/** Only the task's skills reach the runner: tar them from sandbox/skills/. */
async function packSkills(task: TaskName, outFile: string): Promise<void> {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await promisify(execFile)("tar", ["czf", outFile, "-C", SKILLS_DIR, ...skillsFor(task)]);
}

export const runTicket = inngest.createFunction(
  {
    id: "run-ticket",
    triggers: [{ event: RUN_REQUESTED }],
    // Runs share Oscar's Claude subscription limits.
    concurrency: { limit: 1 },
    retries: 2,
    onFailure: async ({ event, step }) => {
      // Backstop: the run's own cleanup normally does this.
      const { runId, ticket } = event.data.event.data as RunRequested;
      await step.run("delete-leftover-sandbox", () => deleteSandbox(sandboxName(ticket.identifier, runId)));
      await step.run("clear-in-progress", () => setInProgress(ticket.id, false));
    },
  },
  async ({ event, step }) => {
    const { runId, ticket, task } = event.data as RunRequested;
    const branch = ticket.branchName;
    const reviewing = task === "review";
    const localDir = runDirFor(runId);
    let sandboxId: string | null = null;

    try {
      // Shows on the ticket while the run works; every ending below removes it.
      await step.run("mark-in-progress", () => setInProgress(ticket.id, true));

      // 1. Bundles of an up-to-date main, built from the host's mirrors. A review also bundles
      // the ticket's branch from every repo that has it on GitHub.
      const { baseShas, reviewRepos, reviewHeads } = await step.run("bundle-main", async () => {
        const shas: Record<string, string> = {};
        const heads: Record<string, string> = {};
        for (const repo of config.repos) {
          shas[repo] = await refreshMirror(repo);
          const head = reviewing ? await fetchBranch(repo, branch) : null;
          if (head) heads[repo] = head;
          await bundleBase(repo, path.join(localDir, "in", `${repo}.bundle`), head ? branch : undefined);
        }
        return { baseShas: shas, reviewRepos: Object.keys(heads), reviewHeads: heads };
      });
      if (reviewing && reviewRepos.length === 0) {
        throw new Error(`Nothing to review: no repo has the branch \`${branch}\` on GitHub.`);
      }

      // 2. The sandbox. Looked up by name first so a retried step doesn't create a second one.
      sandboxId = await step.run("create-sandbox", async () => {
        const name = sandboxName(ticket.identifier, runId);
        const existing = await getSandbox(name).catch(() => null);
        const id = existing?.id ?? (await createSandbox(name, runId));
        updateRun(runId, { status: "running", sandboxId: id, snapshot: config.snapshot(), branch });
        return id;
      });
      const id = sandboxId;

      // 3. Bundles, the task's skills, prompt and MCP config in. The branch is checked out from the
      // new main, or for a review from its own bundle (main again in repos that lack it: an empty diff).
      await step.run("upload-and-checkout", async () => {
        const sb = await getSandbox(id);
        for (const repo of config.repos) {
          await upload(sb, path.join(localDir, "in", `${repo}.bundle`), `${RUN_DIR}/in/${repo}.bundle`);
        }
        const skillsTgz = path.join(localDir, "in", "skills.tgz");
        await packSkills(task, skillsTgz);
        await upload(sb, skillsTgz, `${RUN_DIR}/skills.tgz`);
        const prompt = buildPrompt({ task, ticket, evidenceDir: EVIDENCE_DIR, prBodyPath: PR_BODY, reviewPath: REVIEW });
        fs.writeFileSync(path.join(localDir, "prompt.md"), prompt);
        await upload(sb, Buffer.from(prompt), `${RUN_DIR}/prompt.md`);
        if (!reviewing) await upload(sb, Buffer.from(JSON.stringify(MCP_CONFIG)), `${RUN_DIR}/mcp.json`);
        if (reviewing) {
          await upload(sb, path.join(TASKS_DIR, "review", "extract.md"), `${RUN_DIR}/extract.md`);
          const schema = reviewCommentsJsonSchema(reviewRepos as [string, ...string[]]);
          await upload(sb, Buffer.from(schema), `${RUN_DIR}/review-comments.schema.json`);
        }
        const who = await commitIdentity();
        const repos = config.repos.join(" ");
        const toReview = ` ${reviewRepos.join(" ")} `;
        await sh(
          sb,
          `set -euo pipefail; mkdir -p ${EVIDENCE_DIR}
           rm -rf ~/.claude/skills && mkdir -p ~/.claude/skills && tar xzf ${RUN_DIR}/skills.tgz -C ~/.claude/skills
           for r in ${repos}; do
             cd ~/bunny/$r
             git fetch -q --no-tags ${RUN_DIR}/in/$r.bundle +refs/heads/${config.baseBranch}:refs/remotes/origin/${config.baseBranch}
             start=origin/${config.baseBranch}
             if [[ ${shQuote(toReview)} == *" $r "* ]]; then
               git fetch -q --no-tags ${RUN_DIR}/in/$r.bundle +refs/heads/${shQuote(branch)}:refs/remotes/origin/${shQuote(branch)}
               start=origin/${shQuote(branch)}
             fi
             git checkout -q -f -B ${shQuote(branch)} "$start"
             git config user.name ${shQuote(who.name)}
             git config user.email ${shQuote(who.email)}
           done`,
          600,
        );
      });

      // 4. Catch-up: gems, npm, migrations, then the stack. Runs in the background and is polled.
      // Inngest replays this function for every step, so wall-clock times are taken inside steps.
      // A review only reads diffs, so it skips this.
      if (!reviewing) {
        const catchUp = await step.run("start-catch-up", async () => ({
          startedAt: Date.now(),
          cmdId: await startBackground(
            await getSandbox(id),
            "catch-up",
            `set -o pipefail; { bunny-stack up && bunny-stack run api env RAILS_ENV=test bin/rails db:prepare && bunny-stack smoke; } > ${ARTIFACTS}/catch-up.log 2>&1`,
          ),
        }));
        let catchUpExit: number | null = null;
        for (let i = 0; catchUpExit === null && i < 80; i++) {
          await step.sleep(`catch-up-wait-${i}`, "15s");
          catchUpExit = await step.run(`catch-up-poll-${i}`, async () =>
            exitCodeOf(await getSandbox(id), "catch-up", catchUp.cmdId),
          );
        }
        if (catchUpExit !== 0) {
          throw new Error(`catch-up ${catchUpExit === null ? "timed out" : `exited ${catchUpExit}`}; see catch-up.log`);
        }
        await step.run("record-catch-up", () =>
          updateRun(runId, { catchUpSeconds: Math.round((Date.now() - catchUp.startedAt) / 1000) }),
        );
      }

      // 5. Claude, headless, in the background. Only implement gets the Playwright browser: a review
      // starts no stack, so there's nothing to look at.
      const mcp = reviewing ? "" : `--mcp-config ${RUN_DIR}/mcp.json `;
      const claude = await step.run("start-claude", async () =>
        startBackground(
          await getSandbox(id),
          "claude",
          `cd ~/bunny && claude -p --dangerously-skip-permissions ${mcp}--output-format stream-json --verbose < ${RUN_DIR}/prompt.md > ${ARTIFACTS}/claude.jsonl 2> ${ARTIFACTS}/claude.stderr`,
        ),
      );

      // 6. Poll until Claude exits or the time is up.
      const maxPolls = Math.ceil((config.claudeTimeoutMinutes * 60) / config.pollSeconds);
      let claudeExit: number | null = null;
      for (let i = 0; claudeExit === null && i < maxPolls; i++) {
        await step.sleep(`claude-wait-${i}`, `${config.pollSeconds}s`);
        claudeExit = await step.run(`claude-poll-${i}`, async () =>
          exitCodeOf(await getSandbox(id), "claude", claude),
        );
      }
      const timedOut = claudeExit === null;
      if (timedOut) {
        await step.run("stop-claude", async () =>
          sh(await getSandbox(id), "sudo pkill -f '[c]laude -p' || true"),
        );
      }
      await step.run("record-claude", () => updateRun(runId, { claudeExitCode: claudeExit }));

      // 6b. A review's second pass: resume the session with no tools and ask only for the findings
      // that point at a line, as JSON the CLI checks against the schema. The orchestrator checks it
      // again with the same zod schema; on failure it resumes the session again with the error, up to
      // EXTRACT_RETRIES times. The orchestrator, not the agent, posts the result. Skipped when there
      // is no review to extract from.
      if (reviewing) {
        const repos = reviewRepos as [string, ...string[]];
        const hasReview = await step.run("check-review", async () =>
          (await sh(await getSandbox(id), `test -s ${REVIEW} && echo yes || echo no`)).trim() === "yes",
        );
        let lastError: string | null = null;
        for (let attempt = 0; hasReview && attempt <= EXTRACT_RETRIES; attempt++) {
          const promptFile = attempt === 0 ? `${RUN_DIR}/extract.md` : `${RUN_DIR}/extract-retry-${attempt}.md`;
          const extract = await step.run(`start-extract-${attempt}`, async () => {
            const sb = await getSandbox(id);
            if (attempt > 0) await upload(sb, Buffer.from(extractionRetryPrompt(lastError!)), promptFile);
            // Resuming keeps the session id, so every attempt continues the review's own session.
            return startBackground(
              sb,
              `extract-${attempt}`,
              `cd ~/bunny
               sid=$(grep -m1 -o '"session_id":"[^"]*"' ${ARTIFACTS}/claude.jsonl | cut -d'"' -f4)
               [ -n "$sid" ] || { echo "no session id in claude.jsonl" > ${ARTIFACTS}/extract-${attempt}.stderr; exit 1; }
               claude -p --resume "$sid" --tools "" --output-format json \\
                 --json-schema "$(cat ${RUN_DIR}/review-comments.schema.json)" \\
                 < ${promptFile} > ${REVIEW_COMMENTS} 2> ${ARTIFACTS}/extract-${attempt}.stderr`,
            );
          });
          let extractExit: number | null = null;
          for (let i = 0; extractExit === null && i < Math.ceil(EXTRACT_TIMEOUT_SECONDS / 15); i++) {
            await step.sleep(`extract-${attempt}-wait-${i}`, "15s");
            extractExit = await step.run(`extract-${attempt}-poll-${i}`, async () =>
              exitCodeOf(await getSandbox(id), `extract-${attempt}`, extract),
            );
          }
          if (extractExit === null) {
            // A pass that ran out of time would likely do so again: stop, and post without comments.
            await step.run(`stop-extract-${attempt}`, async () =>
              sh(await getSandbox(id), "sudo pkill -f '[c]laude -p --resume' || true"),
            );
            break;
          }
          lastError = await step.run(`check-extract-${attempt}`, async () => {
            const text = await (await getSandbox(id)).fs.downloadFile(REVIEW_COMMENTS).catch(() => Buffer.from(""));
            const parsed = parseReviewComments(text.toString("utf8"), repos);
            return parsed.ok ? null : parsed.error;
          });
          if (lastError === null) break;
        }
      }

      // 7. Artifacts out, plus bundles of new commits or the review. Happens on success, failure and timeout.
      // A review pushes nothing, so it bundles nothing: its branch's commits are already on GitHub.
      const changed = await step.run("collect", async () => {
        const sb = await getSandbox(id);
        const bundleCommits = reviewing
          ? ""
          : `n=$(git rev-list --count origin/${config.baseBranch}..${shQuote(branch)})
             [ "$n" -gt 0 ] && git bundle create -q ${RUN_DIR}/out/$r.bundle origin/${config.baseBranch}..${shQuote(branch)} 2>/dev/null
             echo "$r $n"`;
        const out = await sh(
          sb,
          `set -uo pipefail; mkdir -p ${RUN_DIR}/out
           for r in ${config.repos.join(" ")}; do
             cd ~/bunny/$r
             git status --short > ${ARTIFACTS}/git-status-$r.txt
             ${bundleCommits}
           done
           tar czf ${RUN_DIR}/artifacts.tgz -C ~ artifacts .claude/projects bunny/.stack/logs 2>/dev/null; true`,
          600,
        );
        const repos = parseChangedRepos(out);
        fs.mkdirSync(path.join(localDir, "out"), { recursive: true });
        await download(sb, `${RUN_DIR}/artifacts.tgz`, path.join(localDir, "artifacts.tgz"));
        for (const { repo } of repos) {
          await download(sb, `${RUN_DIR}/out/${repo}.bundle`, path.join(localDir, "out", `${repo}.bundle`));
        }
        const prBodyText = await sb.fs.downloadFile(PR_BODY).catch(() => Buffer.from(""));
        fs.writeFileSync(path.join(localDir, "pr-body.md"), prBodyText);
        const reviewText = await sb.fs.downloadFile(REVIEW).catch(() => Buffer.from(""));
        fs.writeFileSync(path.join(localDir, "review.md"), reviewText);
        const commentsText = reviewing ? await sb.fs.downloadFile(REVIEW_COMMENTS).catch(() => Buffer.from("")) : Buffer.from("");
        if (reviewing) fs.writeFileSync(path.join(localDir, "review-comments.json"), commentsText);
        return {
          repos,
          prBody: prBodyText.toString("utf8"),
          review: reviewText.toString("utf8"),
          reviewComments: commentsText.toString("utf8"),
        };
      });

      // The sandbox is no longer needed; free it before talking to GitHub.
      await step.run("delete-sandbox", () => deleteSandbox(id));
      sandboxId = null;

      // 8–10 for a review: one GitHub review per open PR, with the review as its body and the
      // findings on their lines; the review in full on the ticket. Code reads the verdict; a review
      // without one is still posted for a human, but the run fails.
      if (reviewing) {
        const review = changed.review.trim();
        const verdict = review ? parseVerdict(review) : null;
        const extracted = review
          ? parseReviewComments(changed.reviewComments, reviewRepos as [string, ...string[]])
          : ({ ok: true, comments: [] } as const);
        const status = !review ? (timedOut ? "timed_out" : "failed") : verdict ? "succeeded" : "failed";
        const posted = await step.run("post-review", async () => {
          const urls: string[] = [];
          let placed = 0;
          let dropped = 0;
          if (!review) return { urls, placed, dropped };
          const comments = extracted.ok ? extracted.comments : [];
          const body = reviewComment(ticket, review, runId);
          for (const repo of reviewRepos) {
            const url = await findOpenPr(repo, branch);
            if (!url) continue;
            // The hunks GitHub shows on the PR, from the host's mirror: the agent doesn't get a say.
            const split = placeComments(comments, repo, diffLines(await branchDiff(repo, branch)));
            for (const c of split.dropped) console.warn(`[${runId}] dropping comment on ${repo}/${c.path}:${c.line}: not in the diff`);
            await postReview(url, reviewHeads[repo]!, body, split.placed);
            urls.push(url);
            placed += split.placed.length;
            dropped += split.dropped.length;
          }
          return { urls, placed, dropped };
        });
        const prUrls = posted.urls;
        await step.run("report", async () => {
          const errors = [
            !review ? "The agent wrote no review." : null,
            review && !verdict ? "The review has no readable verdict: each of `## Standards:` and `## Spec:` once, with PASS or CHANGES REQUESTED." : null,
            review && !extracted.ok ? `No inline comments: ${extracted.error}` : null,
          ].filter((e): e is string => e !== null);
          updateRun(runId, {
            status,
            prUrls,
            reviewVerdict: verdict,
            finishedAt: new Date().toISOString(),
            ...(errors.length ? { error: errors.join(" ") } : {}),
          });
          const prLinks = prUrls.map((u) => `[${u.replace("https://github.com/", "").replace("/pull/", "#")}](${u})`);
          const where = prLinks.length
            ? `Posted on ${prLinks.join(", ")} with ${posted.placed} inline comment${posted.placed === 1 ? "" : "s"}${posted.dropped ? ` (${posted.dropped} dropped: not on a line in the diff)` : ""}.`
            : "No open PR to post on.";
          const head = verdict ? `Reviewed: ${verdictLine(verdict)}. ${where}` : `Reviewed, **without a readable verdict**. ${where}`;
          // The missing verdict is already in the head line.
          const notes = review && !extracted.ok ? [`No inline comments: ${extracted.error}`] : [];
          const text = review
            ? [head, ...notes.map((n) => `⚠️ ${n}`), review].join("\n\n")
            : timedOut
              ? `Timed out after ${config.claudeTimeoutMinutes} minutes without writing a review.`
              : "Finished without writing a review.";
          await comment(ticket.id, linearComment(text, runId));
          await setInProgress(ticket.id, false);
        });
        return { status, prUrls, baseShas };
      }

      // 8. Evidence to Linear: inline on the ticket, linked from the PR (GitHub can't show it inline).
      const evidence = await step.run("publish-evidence", () => publishEvidence(localDir, changed.prBody));
      const agentBody = linkEvidence(changed.prBody, evidence.urls);

      // 9. Push and open one PR per changed repo, as Oscar.
      const prUrls = await step.run("push-and-open-prs", async () => {
        const urls: string[] = [];
        for (const { repo } of changed.repos) {
          await importAndPush(repo, path.join(localDir, "out", `${repo}.bundle`), branch);
          urls.push(await openOrFindPr(repo, branch, prTitle(ticket), prBody(ticket, agentBody, runId)));
        }
        return urls;
      });

      // 10. Hand the PRs to a review run: a second review by an agent that never saw this run's
      // reasoning, which only comments. One per ticket, as with the label, so a ticket already
      // reviewed isn't again.
      const status = prUrls.length > 0 ? "succeeded" : timedOut ? "timed_out" : "no_changes";
      const reviewRunId = await step.run("hand-off-to-review", () =>
        prUrls.length > 0 && !ticketHasRun(ticket.id, "review")
          ? recordRun({ ticketId: ticket.id, ticketIdentifier: ticket.identifier, task: "review", trigger: "implement" })
          : null,
      );
      if (reviewRunId) {
        // Same event id as the poller's, so a `review` label added meanwhile can't start a second one.
        await step.sendEvent("request-review", {
          id: `run-${ticket.id}-review`,
          name: RUN_REQUESTED,
          data: { runId: reviewRunId, ticket, task: "review" } satisfies RunRequested,
        });
      }

      // 11. Report back on the ticket, with the evidence inline.
      await step.run("report", async () => {
        updateRun(runId, { status, prUrls, finishedAt: new Date().toISOString() });
        const head =
          prUrls.length > 0
            ? `Opened ${prUrls.map((u) => `[${u.replace("https://github.com/", "").replace("/pull/", "#")}](${u})`).join(", ")}.`
            : timedOut
              ? `Timed out after ${config.claudeTimeoutMinutes} minutes with no commits.`
              : "Finished without committing any changes.";
        // With PRs, the body lives there; without, it explains what happened.
        const detail = prUrls.length > 0 ? "" : agentBody.trim();
        const handoff = reviewRunId ? `Review run \`${reviewRunId}\` queued.` : "";
        const text = [head, handoff, detail, evidence.linearMarkdown].filter(Boolean).join("\n\n");
        await comment(ticket.id, linearComment(text, runId));
        await setInProgress(ticket.id, false);
      });
      return { status, prUrls, baseShas };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stuck = sandboxId;
      if (stuck) await step.run("delete-sandbox-after-failure", () => deleteSandbox(stuck));
      await step.run("report-failure", async () => {
        updateRun(runId, { status: "failed", error: message, finishedAt: new Date().toISOString() });
        await comment(
          ticket.id,
          linearComment(`The run failed:\n\n\`\`\`\n${message.slice(0, 1500)}\n\`\`\``, runId),
        );
        await setInProgress(ticket.id, false);
      });
      throw err;
    }
  },
);
