// One run of a task on a ticket. Ports runner/sandbox.sh into Inngest steps.
// This file is what every run shares: bundles in, the Daytona sandbox, catch-up, Claude, the
// structured-output pass, the work out and pushed. It knows no task by name: everything a task adds
// (its settings, its inputs before the run, what it does with the work) comes through the `Task`
// in tasks/<task>/index.ts (see src/task.ts).
// Every ending applies a transition from transitions.ts to the ticket's labels; that is how one
// task hands off to the next. Every step is short; the long parts (catch-up, Claude, the
// structured-output pass) run in background sessions that we poll.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "../config.ts";
import { closeIfOpen, getFactoryState, updateRun } from "../db/index.ts";
import { bundleForRun, importAndPush } from "../git.ts";
import { commitIdentity, findOpenPr } from "../github.ts";
import { RunHeartbeat } from "../heartbeat.ts";
import { inngest, RUN_REQUESTED, RUN_STOP } from "../inngest.ts";
import { applyLabels } from "../linear.ts";
import { mayStartRuns, parseChangedRepos, sandboxName, shQuote, type Ticket } from "../logic.ts";
import { buildPrompt, SETTINGS_FILE, SKILLS_DIR, TASKS_DIR } from "../prompt.ts";
import { ARTIFACTS, EVIDENCE_DIR, HOME, RUN_DIR } from "../runner-paths.ts";
import {
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
import { skillsFor, TASKS, type TaskName } from "../tasks.ts";
import { finish, requeue, type Pass } from "../task.ts";
import { finished } from "../transitions.ts";

/** The structured-output pass's `claude --output-format json` result. */
const PASS_OUT = `${ARTIFACTS}/structured-output.json`;
const PASS_SCHEMA = `${RUN_DIR}/structured-output.schema.json`;
/** How long the structured-output pass may take: it only answers from the session, with no tools. */
const PASS_TIMEOUT_SECONDS = 600;
/** The most polls of catch-up, 15 seconds apart. */
const CATCH_UP_POLLS = 80;
/**
 * How long a run may last beyond Claude's time limit, for the sandbox's wall-clock lifetime: catch-up,
 * every structured-output attempt, and half an hour for bundles in and out.
 */
const RUN_OVERHEAD_MINUTES =
  (CATCH_UP_POLLS * 15) / 60 + ((STRUCTURED_RETRIES + 1) * PASS_TIMEOUT_SECONDS) / 60 + 30;

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

/** Only the task's skills reach the runner: tar them from runner-files/skills/. */
async function packSkills(task: TaskName, outFile: string): Promise<void> {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await promisify(execFile)("tar", ["czf", outFile, "-C", SKILLS_DIR, ...skillsFor(task)]);
}

export const runTicket = inngest.createFunction(
  {
    id: "run-ticket",
    triggers: [{ event: RUN_REQUESTED }],
    // Not what caps runs: Inngest counts only steps that are executing, and a run spends most of
    // its life in step.sleep, which frees the slot. The poller keeps at most `maxRuns` in flight
    // (poll-linear.ts); this only matches it, so every run's steps can execute.
    concurrency: { limit: config.maxRuns },
    // Records a heartbeat on every call, so sweep-runs can tell a run Inngest has lost.
    middleware: [RunHeartbeat],
    // `factory stop --now` closes the run's record and moves its labels itself, then cancels it here.
    cancelOn: [{ event: RUN_STOP, match: "data.runId" }],
    retries: 2,
    onFailure: async ({ event, step }) => {
      // Backstop: the run's own cleanup normally does this. The record is closed first, or the
      // poller would see a run in flight and never pick the ticket up again.
      const { runId, ticket, task } = event.data.event.data as RunRequested;
      await step.run("delete-leftover-sandbox", () => deleteSandbox(sandboxName(ticket.identifier, runId)));
      await step.run("mark-stopped", async () => {
        closeIfOpen(runId, "failed");
        await applyLabels(ticket.id, finished(task, { status: "failed", next: "human" }));
      });
    },
  },
  async ({ event, step }) => {
    const { runId, ticket, task } = event.data as RunRequested;
    const branch = ticket.branchName;
    const settings = TASKS[task];
    const timeLimitMinutes = settings.timeLimitMinutes ?? config.claudeTimeoutMinutes;
    const localDir = runDirFor(runId);
    let sandboxId: string | null = null;

    try {
      // 1. Bundles of an up-to-date main, built from the orchestrator's mirrors, plus the ticket's branch
      // from every repo that has it on GitHub, unless the task never touches it.
      const usesBranch = settings.branch !== "none";
      // Only a task that builds on the branch pushes: `read` checks it out, and anything committed stays on the runner.
      const pushes = settings.branch === "optional" || settings.branch === "required";
      const { baseShas, heads } = await step.run("bundle-main", async () => {
        const shas: Record<string, string> = {};
        const found: Record<string, string> = {};
        for (const repo of config.repos) {
          const { base, head } = await bundleForRun(repo, path.join(localDir, "in", `${repo}.bundle`), usesBranch ? branch : null);
          shas[repo] = base;
          if (head) found[repo] = head;
        }
        return { baseShas: shas, heads: found };
      });
      const onGitHub = Object.keys(heads);
      if ((settings.branch === "required" || settings.branch === "read") && onGitHub.length === 0) {
        throw new Error(`Nothing to ${task}: no repo has the branch \`${branch}\` on GitHub.`);
      }

      // The open PR of each repo with the branch, looked up once: the run opens none until it ends.
      const openPrs = await step.run("find-open-prs", async () => {
        const found: Record<string, string> = {};
        for (const repo of onGitHub) {
          const url = await findOpenPr(repo, branch);
          if (url) found[repo] = url;
        }
        return found;
      });

      // 1b. The task's own inputs, gathered before the sandbox exists. The task may end the run
      // here instead, when there is nothing for an agent to do.
      const prepared = await settings.prepare({ step, runId, ticket, branch, localDir, timeLimitMinutes, heads, openPrs });
      if ("stop" in prepared) {
        const { end, text, record } = prepared.stop;
        await step.run("stop-before-runner", () => finish({ runId, ticketId: ticket.id, end, text, record: record ?? {} }));
        return { status: end.status, prUrls: [], baseShas };
      }
      const { pass } = prepared;

      // 1c. `factory stop` drains: a run with no runner yet ends here, cancelled, and its ticket stays
      // queued. Checked again here, not only by the poller, since a run may wait in Inngest's queue.
      const may = await step.run("may-start-runner", () => mayStartRuns(config.poll, getFactoryState().state));
      if (!may) {
        await step.run("requeue", () =>
          requeue({ runId, ticketId: ticket.id, text: "The factory was stopped before this run got a runner." }),
        );
        return { status: "cancelled" as const, prUrls: [], baseShas };
      }

      // 2. The sandbox. Looked up by name first so a retried step doesn't create a second one; one a
      // cut-off attempt left half-created is waited for.
      sandboxId = await step.run("create-sandbox", async () => {
        const name = sandboxName(ticket.identifier, runId);
        const existing = await getSandbox(name).catch(() => null);
        if (existing) await existing.waitUntilStarted(300);
        const id = existing?.id ?? (await createSandbox(name, runId, timeLimitMinutes + RUN_OVERHEAD_MINUTES));
        updateRun(runId, { status: "running", sandboxId: id, snapshot: config.snapshot(), branch });
        return id;
      });
      const id = sandboxId;

      // 3. Bundles, Claude's settings, the task's skills, prompt, docs and MCP config in. Each repo checks the branch out
      // from its own bundle where it's on GitHub, and from the new main elsewhere. A task that never
      // touches the branch gets a detached `origin/main`, so a commit has nowhere to go.
      await step.run("upload-and-checkout", async () => {
        const sb = await getSandbox(id);
        for (const repo of config.repos) {
          await upload(sb, path.join(localDir, "in", `${repo}.bundle`), `${RUN_DIR}/in/${repo}.bundle`);
        }
        const skillsTgz = path.join(localDir, "in", "skills.tgz");
        await packSkills(task, skillsTgz);
        await upload(sb, skillsTgz, `${RUN_DIR}/skills.tgz`);
        await upload(sb, SETTINGS_FILE, `${HOME}/.claude/settings.json`);
        const prompt = buildPrompt({ task, ticket, timeLimitMinutes, vars: prepared.vars });
        fs.writeFileSync(path.join(localDir, "prompt.md"), prompt);
        await upload(sb, Buffer.from(prompt), `${RUN_DIR}/prompt.md`);
        for (const doc of settings.docs) await upload(sb, path.join(TASKS_DIR, task, doc), `${RUN_DIR}/${doc}`);
        if (settings.browser) await upload(sb, Buffer.from(JSON.stringify(MCP_CONFIG)), `${RUN_DIR}/mcp.json`);
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
             ${usesBranch ? `git checkout -q -f -B ${shQuote(branch)} "$start"` : `git checkout -q -f --detach "$start"`}
             git config user.name ${shQuote(who.name)}
             git config user.email ${shQuote(who.email)}
           done`,
          600,
        );
      });

      // 4. Catch-up: gems, npm, migrations, then the stack, for a task that uses it. Runs in the
      // background and is polled. Inngest replays this function for every step, so wall-clock
      // times are taken inside steps. Flipping a task's `stack` changes its steps: deploy that with
      // none of its runs in flight (coding standards, rule 9).
      if (settings.stack) {
        const catchUp = await step.run("start-catch-up", async () => ({
          startedAt: Date.now(),
          cmdId: await startBackground(
            await getSandbox(id),
            "catch-up",
            `set -o pipefail; { bunny-stack up && bunny-stack run api env RAILS_ENV=test bin/rails db:prepare && bunny-stack smoke; } > ${ARTIFACTS}/catch-up.log 2>&1`,
          ),
        }));
        let catchUpExit: number | null = null;
        for (let i = 0; catchUpExit === null && i < CATCH_UP_POLLS; i++) {
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

      // 5. Claude, headless, in the background, with the Playwright browser if the task gets one.
      const mcp = settings.browser ? `--mcp-config ${RUN_DIR}/mcp.json ` : "";
      const claude = await step.run("start-claude", async () =>
        startBackground(
          await getSandbox(id),
          "claude",
          `cd ~/bunny && claude -p --dangerously-skip-permissions ${mcp}--output-format stream-json --verbose < ${RUN_DIR}/prompt.md > ${ARTIFACTS}/claude.jsonl 2> ${ARTIFACTS}/claude.stderr`,
        ),
      );

      // 6. Poll until Claude exits or the time is up.
      const maxPolls = Math.ceil((timeLimitMinutes * 60) / config.pollSeconds);
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
      const structuredPass = async ({ parse, retryPrompt }: Pass): Promise<string | null> => {
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
            const parsed = parse(text.toString("utf8"), stderr.toString("utf8"));
            return parsed.ok ? null : parsed.error;
          });
          if (lastError === null) return null;
        }
        return lastError;
      };

      // A pass that needs a file the agent didn't write has nothing to extract.
      const needs = pass?.needs;
      const runPass =
        pass !== null &&
        (!needs ||
          (await step.run(`check-${task}`, async () =>
            (await sh(await getSandbox(id), `test -s ${needs} && echo yes || echo no`)).trim() === "yes",
          )));
      const passError = runPass ? await structuredPass(pass) : null;

      // 7. Artifacts out, the task's files, plus a bundle per repo with new commits: since the
      // branch's head on GitHub, or since main where it isn't there yet; none for a task that never
      // pushes. Happens on success, failure and timeout.
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
             n=${pushes ? `$(git rev-list --count "$start"..${shQuote(branch)})` : "0"}
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
        // Each file is also kept in the run's folder, under its own name.
        const read = async (remote: string) => {
          const text = await sb.fs.downloadFile(remote).catch(() => Buffer.from(""));
          fs.writeFileSync(path.join(localDir, path.basename(remote)), text);
          return text.toString("utf8");
        };
        const files: Record<string, string> = {};
        for (const [key, remote] of Object.entries(prepared.outputs)) files[key] = await read(remote);
        return { repos, files, structured: await read(PASS_OUT) };
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

      // 9. The task posts its result and reports on the ticket.
      const { status, prUrls } = await prepared.conclude({
        files: changed.files,
        structured: changed.structured,
        passError,
        timedOut,
        pushed,
        newHeads,
        commits,
      });
      return { status, prUrls, baseShas };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stuck = sandboxId;
      if (stuck) await step.run("delete-sandbox-after-failure", () => deleteSandbox(stuck));
      await step.run("report-failure", () =>
        finish({
          runId,
          ticketId: ticket.id,
          end: { status: "failed", next: "human" },
          text: `The run failed:\n\n\`\`\`\n${message.slice(0, 1500)}\n\`\`\``,
          record: { error: message },
        }),
      );
      throw err;
    }
  },
);
