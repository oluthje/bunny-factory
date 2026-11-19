// One run of a task on a ticket. Ports runner/sandbox.sh into Inngest steps.
// - `implement` creates or updates: with no branch on GitHub it branches from main and opens draft
//   PRs; with one, it builds on the branch with Oscar's feedback and replies on Oscar's review threads.
// - `review` fixes what it's sure of, pushes that, posts the rest as a GitHub review and marks the
//   PRs ready.
// Every ending applies a transition from transitions.ts to the ticket's labels; that is how one
// task hands off to the next. Every step is short; the long parts (catch-up, Claude, the
// structured-output pass) run in background sessions that we poll.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "../config.ts";
import { closeIfOpen, lastFinishedAt, updateRun } from "../db/index.ts";
import { publishEvidence } from "../evidence.ts";
import { renderFeedback } from "../feedback.ts";
import { branchDiff, bundleBase, fetchBranch, importAndPush, refreshMirror } from "../git.ts";
import {
  commitIdentity,
  findOpenPr,
  getPrBody,
  markReady,
  openOrFindPr,
  postReview,
  prComments,
  replyToThread,
  reviewThreads,
  setPrBody,
  viewerLogin,
} from "../github.ts";
import { inngest, RUN_REQUESTED } from "../inngest.ts";
import { applyLabels, comment, ticketComments } from "../linear.ts";
import {
  linearComment,
  linkEvidence,
  markForGithub,
  parseChangedRepos,
  prBody,
  prTitle,
  reviewComment,
  sandboxName,
  shQuote,
  type Ticket,
} from "../logic.ts";
import { buildPrompt, SETTINGS_FILE, SKILLS_DIR, TASKS_DIR } from "../prompt.ts";
import { parseThreadReplies, replyBody, replyRetryPrompt, threadRepliesJsonSchema } from "../replies.ts";
import {
  diffLines,
  extractionRetryPrompt,
  parseReviewComments,
  parseVerdict,
  placeComments,
  reviewCommentsJsonSchema,
  verdictLine,
} from "../review.ts";
import {
  ARTIFACTS,
  HOME,
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
import { STRUCTURED_RETRIES } from "../structured.ts";
import { skillsFor, taskLabel, type TaskName } from "../tasks.ts";
import { finished, nextTask, type RunEnd } from "../transitions.ts";

const EVIDENCE_DIR = `${ARTIFACTS}/evidence`;
const PR_BODY = `${ARTIFACTS}/pr-body.md`;
const REVIEW = `${ARTIFACTS}/review.md`;
/** The structured-output pass's `claude --output-format json` result: review's inline comments, or implement's thread replies. */
const PASS_OUT = `${ARTIFACTS}/structured-output.json`;
const PASS_SCHEMA = `${RUN_DIR}/structured-output.schema.json`;
/** How long the structured-output pass may take: it only answers from the session, with no tools. */
const PASS_TIMEOUT_SECONDS = 600;

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

const prRef = (u: string) => `[${u.replace("https://github.com/", "").replace("/pull/", "#")}](${u})`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The end of the run's Linear report: what the ticket's labels now ask for. */
function handoffLine(end: RunEnd): string {
  const next = nextTask(end);
  return next ? `Handing off: \`${taskLabel(next)}\` queued.` : "Waiting on Oscar.";
}

/** Records the run's end, then moves the ticket's labels on. The record goes first: the poller only picks up a ticket with no run in flight. */
async function finish(runId: string, ticketId: string, end: RunEnd, text: string, record: Parameters<typeof updateRun>[1]) {
  updateRun(runId, { ...record, status: end.status, finishedAt: new Date().toISOString() });
  await comment(ticketId, linearComment(`${text}\n\n${handoffLine(end)}`, runId));
  await applyLabels(ticketId, finished(end));
}

export const runTicket = inngest.createFunction(
  {
    id: "run-ticket",
    triggers: [{ event: RUN_REQUESTED }],
    // Runs share Oscar's Claude subscription limits.
    concurrency: { limit: 1 },
    retries: 2,
    onFailure: async ({ event, step }) => {
      // Backstop: the run's own cleanup normally does this. The record is closed first, or the
      // poller would see a run in flight and never pick the ticket up again.
      const { runId, ticket, task } = event.data.event.data as RunRequested;
      await step.run("delete-leftover-sandbox", () => deleteSandbox(sandboxName(ticket.identifier, runId)));
      await step.run("mark-stopped", async () => {
        closeIfOpen(runId, "failed");
        await applyLabels(ticket.id, finished({ task, status: "failed", pushed: false }));
      });
    },
  },
  async ({ event, step }) => {
    const { runId, ticket, task } = event.data as RunRequested;
    const branch = ticket.branchName;
    const reviewing = task === "review";
    const localDir = runDirFor(runId);
    let sandboxId: string | null = null;

    try {
      // 1. Bundles of an up-to-date main, built from the host's mirrors, plus the ticket's branch
      // from every repo that has it on GitHub. A review needs it; an implement run that finds it updates.
      const { baseShas, heads } = await step.run("bundle-main", async () => {
        const shas: Record<string, string> = {};
        const found: Record<string, string> = {};
        for (const repo of config.repos) {
          shas[repo] = await refreshMirror(repo);
          const head = await fetchBranch(repo, branch);
          if (head) found[repo] = head;
          await bundleBase(repo, path.join(localDir, "in", `${repo}.bundle`), head ? branch : undefined);
        }
        return { baseShas: shas, heads: found };
      });
      const onGitHub = Object.keys(heads);
      if (reviewing && onGitHub.length === 0) {
        throw new Error(`Nothing to review: no repo has the branch \`${branch}\` on GitHub.`);
      }
      const updating = !reviewing && onGitHub.length > 0;

      // The open PR of each repo with the branch, looked up once: the run opens none until it ends.
      const openPrs = await step.run("find-open-prs", async () => {
        const found: Record<string, string> = {};
        for (const repo of onGitHub) {
          const url = await findOpenPr(repo, branch);
          if (url) found[repo] = url;
        }
        return found;
      });
      const openUrls = Object.values(openPrs);

      // 1b. An update's feedback, acted on with the ticket still the spec: Oscar's review threads
      // waiting on the factory, PR comments and ticket comments. "New" means since the ticket's
      // previous run finished.
      const feedback = updating
        ? await step.run("gather-feedback", async () => {
            return renderFeedback({
              threads: (await Promise.all(openUrls.map(reviewThreads))).flat(),
              prComments: (await Promise.all(openUrls.map(prComments))).flat(),
              ticketComments: await ticketComments(ticket.id),
              since: lastFinishedAt(ticket.id, runId),
              viewer: await viewerLogin(),
            });
          })
        : null;
      const handles = Object.keys(feedback?.handles ?? {});

      // The structured-output pass, if the run has one: review's inline comments, or an update's
      // thread replies. Each validator returns an error, or null when the output is good.
      const pass = reviewing
        ? {
            schema: reviewCommentsJsonSchema(onGitHub as [string, ...string[]]),
            validate: (text: string, stderr: string) => {
              const parsed = parseReviewComments(text, onGitHub as [string, ...string[]], stderr);
              return parsed.ok ? null : parsed.error;
            },
            retryPrompt: extractionRetryPrompt,
          }
        : handles.length > 0
          ? {
              schema: threadRepliesJsonSchema(handles as [string, ...string[]]),
              validate: (text: string, stderr: string) => {
                const parsed = parseThreadReplies(text, handles as [string, ...string[]], stderr);
                return parsed.ok ? null : parsed.error;
              },
              retryPrompt: replyRetryPrompt,
            }
          : null;

      // 1c. A review's context: the PR body, with the implementer's Decisions. Every repo's PR has
      // the same body, so the first open one will do.
      const reviewedPrBody =
        reviewing && openUrls.length > 0 ? await step.run("fetch-pr-body", () => getPrBody(openUrls[0]!)) : null;

      // 2. The sandbox. Looked up by name first so a retried step doesn't create a second one.
      sandboxId = await step.run("create-sandbox", async () => {
        const name = sandboxName(ticket.identifier, runId);
        const existing = await getSandbox(name).catch(() => null);
        const id = existing?.id ?? (await createSandbox(name, runId));
        updateRun(runId, { status: "running", sandboxId: id, snapshot: config.snapshot(), branch });
        return id;
      });
      const id = sandboxId;

      // 3. Bundles, Claude's settings, the task's skills, prompt and MCP config in. Each repo checks the branch out
      // from its own bundle where it's on GitHub, and from the new main elsewhere.
      await step.run("upload-and-checkout", async () => {
        const sb = await getSandbox(id);
        for (const repo of config.repos) {
          await upload(sb, path.join(localDir, "in", `${repo}.bundle`), `${RUN_DIR}/in/${repo}.bundle`);
        }
        const skillsTgz = path.join(localDir, "in", "skills.tgz");
        await packSkills(task, skillsTgz);
        await upload(sb, skillsTgz, `${RUN_DIR}/skills.tgz`);
        await upload(sb, SETTINGS_FILE, `${HOME}/.claude/settings.json`);
        const prompt = buildPrompt({
          task,
          ticket,
          evidenceDir: EVIDENCE_DIR,
          prBodyPath: PR_BODY,
          reviewPath: REVIEW,
          update: feedback ? { feedback: feedback.markdown } : null,
          prBody: reviewedPrBody,
        });
        fs.writeFileSync(path.join(localDir, "prompt.md"), prompt);
        await upload(sb, Buffer.from(prompt), `${RUN_DIR}/prompt.md`);
        if (!reviewing) await upload(sb, Buffer.from(JSON.stringify(MCP_CONFIG)), `${RUN_DIR}/mcp.json`);
        if (pass) {
          await upload(sb, Buffer.from(pass.schema), PASS_SCHEMA);
          await upload(sb, path.join(TASKS_DIR, task, "extract.md"), `${RUN_DIR}/extract.md`);
        }
        const who = await commitIdentity();
        const repos = config.repos.join(" ");
        const withBranch = ` ${onGitHub.join(" ")} `;
        await sh(
          sb,
          `set -euo pipefail; mkdir -p ${EVIDENCE_DIR}
           rm -rf ~/.claude/skills && mkdir -p ~/.claude/skills && tar xzf ${RUN_DIR}/skills.tgz -C ~/.claude/skills
           for r in ${repos}; do
             cd ~/bunny/$r
             git fetch -q --no-tags ${RUN_DIR}/in/$r.bundle +refs/heads/${config.baseBranch}:refs/remotes/origin/${config.baseBranch}
             start=origin/${config.baseBranch}
             if [[ ${shQuote(withBranch)} == *" $r "* ]]; then
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

      // 5. Claude, headless, in the background. Only implement gets the Playwright browser: a review
      // runs specs but captures no evidence.
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

      // 6b. The structured-output pass: resume the session with no tools and ask for JSON the CLI
      // checks against the schema. The orchestrator checks it again with the same zod schema; on
      // failure it resumes again with the error, up to STRUCTURED_RETRIES times. The orchestrator,
      // not the agent, posts the result. Returns the last error, or null when the output is good.
      const structuredPass = async ({ validate, retryPrompt }: NonNullable<typeof pass>): Promise<string | null> => {
        let lastError: string | null = null;
        for (let attempt = 0; attempt <= STRUCTURED_RETRIES; attempt++) {
          const promptFile = attempt === 0 ? `${RUN_DIR}/extract.md` : `${RUN_DIR}/extract-retry-${attempt}.md`;
          const started = await step.run(`start-extract-${attempt}`, async () => {
            const sb = await getSandbox(id);
            if (attempt > 0) await upload(sb, Buffer.from(retryPrompt(lastError!)), promptFile);
            // Resuming keeps the session id, so every attempt continues the run's own session.
            return startBackground(
              sb,
              `extract-${attempt}`,
              `cd ~/bunny
               sid=$(grep -m1 -o '"session_id":"[^"]*"' ${ARTIFACTS}/claude.jsonl | cut -d'"' -f4)
               [ -n "$sid" ] || { echo "no session id in claude.jsonl" > ${ARTIFACTS}/extract-${attempt}.stderr; exit 1; }
               claude -p --resume "$sid" --tools "" --output-format json \\
                 --json-schema "$(cat ${PASS_SCHEMA})" \\
                 < ${promptFile} > ${PASS_OUT} 2> ${ARTIFACTS}/extract-${attempt}.stderr`,
            );
          });
          let exit: number | null = null;
          for (let i = 0; exit === null && i < Math.ceil(PASS_TIMEOUT_SECONDS / 15); i++) {
            await step.sleep(`extract-${attempt}-wait-${i}`, "15s");
            exit = await step.run(`extract-${attempt}-poll-${i}`, async () =>
              exitCodeOf(await getSandbox(id), `extract-${attempt}`, started),
            );
          }
          if (exit === null) {
            // A pass that ran out of time would likely do so again: stop, and go on without its output.
            await step.run(`stop-extract-${attempt}`, async () =>
              sh(await getSandbox(id), "sudo pkill -f '[c]laude -p --resume' || true"),
            );
            return `The pass timed out after ${PASS_TIMEOUT_SECONDS / 60} minutes.`;
          }
          lastError = await step.run(`check-extract-${attempt}`, async () => {
            const sb = await getSandbox(id);
            const text = await sb.fs.downloadFile(PASS_OUT).catch(() => Buffer.from(""));
            const stderr = await sb.fs.downloadFile(`${ARTIFACTS}/extract-${attempt}.stderr`).catch(() => Buffer.from(""));
            return validate(text.toString("utf8"), stderr.toString("utf8"));
          });
          if (lastError === null) return null;
        }
        return lastError;
      };

      // A review with no review file has nothing to extract.
      const runPass =
        pass !== null &&
        (!reviewing ||
          (await step.run("check-review", async () =>
            (await sh(await getSandbox(id), `test -s ${REVIEW} && echo yes || echo no`)).trim() === "yes",
          )));
      const passError = runPass ? await structuredPass(pass) : null;

      // 7. Artifacts out, plus a bundle per repo with new commits: since the branch's head on
      // GitHub, or since main where it isn't there yet. Happens on success, failure and timeout.
      const changed = await step.run("collect", async () => {
        const sb = await getSandbox(id);
        const out = await sh(
          sb,
          `set -uo pipefail; mkdir -p ${RUN_DIR}/out
           for r in ${config.repos.join(" ")}; do
             cd ~/bunny/$r
             git status --short > ${ARTIFACTS}/git-status-$r.txt
             start=origin/${config.baseBranch}
             git rev-parse -q --verify refs/remotes/origin/${shQuote(branch)} >/dev/null && start=origin/${shQuote(branch)}
             n=$(git rev-list --count "$start"..${shQuote(branch)})
             [ "$n" -gt 0 ] && git bundle create -q ${RUN_DIR}/out/$r.bundle origin/${config.baseBranch}..${shQuote(branch)} 2>/dev/null
             echo "$r $n"
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
        const read = async (remote: string, local: string) => {
          const text = await sb.fs.downloadFile(remote).catch(() => Buffer.from(""));
          fs.writeFileSync(path.join(localDir, local), text);
          return text.toString("utf8");
        };
        return {
          repos,
          prBody: await read(PR_BODY, "pr-body.md"),
          review: await read(REVIEW, "review.md"),
          structured: await read(PASS_OUT, "structured-output.json"),
        };
      });

      // The sandbox is no longer needed; free it before talking to GitHub.
      await step.run("delete-sandbox", () => deleteSandbox(id));
      sandboxId = null;

      // 8. New commits to GitHub, without force: a branch that moved meanwhile fails the push
      // rather than losing work. Returns each repo's head after the push.
      const pushed = changed.repos.map((r) => r.repo);
      const newHeads = await step.run("push", async () => {
        const after: Record<string, string> = { ...heads };
        for (const repo of pushed) {
          after[repo] = await importAndPush(repo, path.join(localDir, "out", `${repo}.bundle`), branch);
        }
        return after;
      });
      const commits = changed.repos.reduce((n, r) => n + r.commits, 0);

      // 9–11 for a review: one GitHub review per open PR, with the review as its body and the
      // findings it left on their lines; the PRs marked ready; the review in full on the ticket.
      // Code reads the verdict; a review without one is still posted for a human, but the run fails.
      if (reviewing) {
        const review = changed.review.trim();
        const verdict = review ? parseVerdict(review) : null;
        const repos = onGitHub as [string, ...string[]];
        // The last attempt's error says more than a re-parse of its output would.
        const extracted = !review
          ? ({ ok: true, comments: [] } as const)
          : passError
            ? ({ ok: false, error: passError } as const)
            : parseReviewComments(changed.structured, repos);
        const posted = await step.run("post-review", async () => {
          const urls: string[] = [];
          let placed = 0;
          let dropped = 0;
          if (!review) return { urls, placed, dropped };
          const comments = extracted.ok ? extracted.comments : [];
          const body = reviewComment(ticket, review, runId);
          for (const [repo, url] of Object.entries(openPrs)) {
            // The hunks GitHub shows on the PR, from the host's mirror, which the push updated.
            const split = placeComments(comments, repo, diffLines(await branchDiff(repo, branch)));
            for (const c of split.dropped) console.warn(`[${runId}] dropping comment on ${repo}/${c.path}:${c.line}: not in the diff`);
            const inline = split.placed.map((c) => ({ ...c, body: markForGithub(c.body) }));
            await postReview(url, newHeads[repo]!, body, inline);
            // Through automated review: a human can pick it up.
            await markReady(url);
            urls.push(url);
            placed += split.placed.length;
            dropped += split.dropped.length;
          }
          return { urls, placed, dropped };
        });
        const status = !review ? (timedOut ? "timed_out" : "failed") : verdict ? "succeeded" : "failed";
        await step.run("report", async () => {
          const errors = [
            !review ? "The agent wrote no review." : null,
            review && !verdict ? "The review has no readable verdict: each of `## Standards:` and `## Spec:` once, with PASS or CHANGES REQUESTED." : null,
            review && !extracted.ok ? `No inline comments: ${extracted.error}` : null,
          ].filter((e): e is string => e !== null);
          const where = posted.urls.length
            ? `Posted on ${posted.urls.map(prRef).join(", ")} with ${plural(posted.placed, "inline comment")}${posted.dropped ? ` (${posted.dropped} dropped: not on a line in the diff)` : ""}, and marked ready for review.`
            : "No open PR to post on.";
          const fixes = commits ? ` Pushed ${plural(commits, "fix commit")}.` : "";
          const head = verdict ? `Reviewed: ${verdictLine(verdict)}. ${where}${fixes}` : `Reviewed, **without a readable verdict**. ${where}${fixes}`;
          // The missing verdict is already in the head line.
          const notes = review && !extracted.ok ? [`⚠️ No inline comments: ${extracted.error}`] : [];
          const text = review
            ? [head, ...notes, review].join("\n\n")
            : timedOut
              ? `Timed out after ${config.claudeTimeoutMinutes} minutes without writing a review.${fixes}`
              : `Finished without writing a review.${fixes}`;
          await finish(runId, ticket.id, { task, status, pushed: pushed.length > 0 }, text, {
            prUrls: posted.urls,
            reviewVerdict: verdict,
            ...(errors.length ? { error: errors.join(" ") } : {}),
          });
        });
        return { status, prUrls: posted.urls, baseShas };
      }

      // 9. Evidence to Linear: inline on the ticket, linked from the PR (GitHub can't show it inline).
      const evidence = await step.run("publish-evidence", () => publishEvidence(localDir, changed.prBody));
      const agentBody = linkEvidence(changed.prBody, evidence.urls);

      // 10. PRs: a draft for each repo the run pushed to that has none, and the body replaced on the
      // open ones.
      const prs = await step.run("open-or-update-prs", async () => {
        const opened: string[] = [];
        const updated: string[] = [];
        const body = prBody(ticket, agentBody, runId);
        for (const repo of config.repos) {
          const open = openPrs[repo];
          if (open) {
            if (changed.prBody.trim()) await setPrBody(open, body);
            updated.push(open);
          } else if (pushed.includes(repo)) {
            opened.push(await openOrFindPr(repo, branch, prTitle(ticket), body));
          }
        }
        return { opened, updated };
      });
      const prUrls = [...prs.opened, ...prs.updated];

      // 11. Replies on the review threads the update was given, as the factory.
      const replied = await step.run("post-replies", async () => {
        if (!feedback || handles.length === 0 || passError) return 0;
        const parsed = parseThreadReplies(changed.structured, handles as [string, ...string[]]);
        if (!parsed.ok) return 0;
        for (const r of parsed.replies) await replyToThread(feedback.handles[r.thread]!, replyBody(r, runId));
        return parsed.replies.length;
      });

      // 12. Report back on the ticket, with the evidence inline, and hand off.
      const status = pushed.length > 0 ? "succeeded" : timedOut ? "timed_out" : "no_changes";
      await step.run("report", async () => {
        const lines = [
          prs.opened.length ? `Opened ${prs.opened.map(prRef).join(", ")} as ${config.draftPrs ? "drafts" : "PRs"}.` : null,
          prs.updated.length ? `Updated ${prs.updated.map(prRef).join(", ")}.` : null,
          commits ? `Pushed ${plural(commits, "commit")}.` : null,
          handles.length ? `Replied on ${replied} of ${plural(handles.length, "review thread")}.` : null,
          passError ? `⚠️ No thread replies: ${passError}` : null,
          pushed.length === 0
            ? timedOut
              ? `Timed out after ${config.claudeTimeoutMinutes} minutes with no commits.`
              : "Finished without committing any changes."
            : null,
          // With PRs, the body lives there; without, it explains what happened.
          prUrls.length > 0 ? null : agentBody.trim(),
          evidence.linearMarkdown,
        ].filter((l): l is string => Boolean(l));
        await finish(runId, ticket.id, { task, status, pushed: pushed.length > 0 }, lines.join("\n\n"), { prUrls });
      });
      return { status, prUrls, baseShas };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stuck = sandboxId;
      if (stuck) await step.run("delete-sandbox-after-failure", () => deleteSandbox(stuck));
      await step.run("report-failure", () =>
        finish(runId, ticket.id, { task, status: "failed", pushed: false }, `The run failed:\n\n\`\`\`\n${message.slice(0, 1500)}\n\`\`\``, {
          error: message,
        }),
      );
      throw err;
    }
  },
);
