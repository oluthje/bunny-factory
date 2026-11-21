// Orchestrator-side git: bare mirrors of the Bunny repos on the data volume. Code enters and leaves
// runners only as git bundles, so the PAT stays here. Runs share the mirrors, so every operation
// on one holds its repo's lock: two fetches into the same mirror can fail on its ref locks.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "./config.ts";

const run = promisify(execFile);

/**
 * Auth for github.com through git's environment config, never argv: a token in a command line
 * shows up in `ps` (the old PAT leaked that way).
 */
function authEnv(): NodeJS.ProcessEnv {
  const basic = Buffer.from(`x-access-token:${config.ghToken()}`).toString("base64");
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
}

async function git(args: string[], opts: { cwd?: string; auth?: boolean } = {}): Promise<string> {
  const { stdout } = await run("git", args, {
    cwd: opts.cwd,
    env: opts.auth ? authEnv() : process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.trim();
}

/** Each repo's queue of mirror operations. In-process: the orchestrator is one Node process. */
const locks = new Map<string, Promise<unknown>>();

/** Runs `fn` once every earlier operation on the repo's mirror has settled. */
function withMirror<T>(repo: string, fn: () => Promise<T>): Promise<T> {
  const result = (locks.get(repo) ?? Promise.resolve()).then(fn, fn);
  locks.set(repo, result.catch(() => undefined));
  return result;
}

export function mirrorDir(repo: string): string {
  return path.join(config.dataDir, "mirrors", `${repo}.git`);
}

function remoteUrl(repo: string): string {
  return `https://github.com/${config.githubOwner}/${repo}.git`;
}

/**
 * Clones the mirror on first use, then fetches main, and `base` when it isn't main. Returns `base`'s
 * sha. A base not on GitHub yet (a bulk branch this repo hasn't used) starts at main: the mirror's
 * ref points there, so the run's bundle carries it under its own name, and the PR creates it.
 */
async function refreshMirror(repo: string, base: string): Promise<string> {
  const dir = mirrorDir(repo);
  const main = config.baseBranch;
  if (!fs.existsSync(path.join(dir, "HEAD"))) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await git(["clone", "--bare", "--single-branch", "--branch", main, remoteUrl(repo), dir], { auth: true });
  } else {
    await git(["fetch", "--quiet", "--no-tags", "origin", `+refs/heads/${main}:refs/heads/${main}`], {
      cwd: dir,
      auth: true,
    });
  }
  if (base !== main && !(await fetchBranch(repo, base))) {
    await git(["update-ref", `refs/heads/${base}`, `refs/heads/${main}`], { cwd: dir });
  }
  return git(["rev-parse", `refs/heads/${base}`], { cwd: dir });
}

/**
 * Fetches a work branch from GitHub into the mirror, for a run that builds on it.
 * Returns its sha, or null when the repo has no such branch.
 */
async function fetchBranch(repo: string, branch: string): Promise<string | null> {
  const dir = mirrorDir(repo);
  const heads = await git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`], { cwd: dir, auth: true });
  if (!heads) return null;
  await git(["fetch", "--quiet", "--no-tags", "origin", `+refs/heads/${branch}:refs/heads/${branch}`], {
    cwd: dir,
    auth: true,
  });
  return git(["rev-parse", `refs/heads/${branch}`], { cwd: dir });
}

/**
 * The branch's diff against the base, three-dot (from the merge-base), as GitHub shows it on the
 * PR: default context, no colour or external diff tools.
 */
export function branchDiff(repo: string, branch: string, base: string): Promise<string> {
  return withMirror(repo, async () => {
    return git(
      ["diff", "--no-color", "--no-ext-diff", `refs/heads/${base}...refs/heads/${branch}`],
      { cwd: mirrorDir(repo) },
    );
  });
}

/**
 * A full bundle of the base branch, plus the work branch when given. Full, because the sandbox's
 * clones are partial (blob:none).
 */
async function bundleBase(repo: string, outFile: string, base: string, branch?: string): Promise<void> {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const refs = [`refs/heads/${base}`, ...(branch ? [`refs/heads/${branch}`] : [])];
  await git(["bundle", "create", outFile, ...refs], { cwd: mirrorDir(repo) });
}

/**
 * A run's way in: refreshes the mirror's `base` (main, or a bulk branch), fetches the run's branch
 * when `branch` is given and it's on GitHub, and bundles both, all under one hold of the repo's
 * lock so the bundle's base is the sha returned as `base`. `head` is the branch's sha on GitHub, or null.
 */
export function bundleForRun(
  repo: string,
  outFile: string,
  baseBranch: string,
  branch: string | null,
): Promise<{ base: string; head: string | null }> {
  return withMirror(repo, async () => {
    const base = await refreshMirror(repo, baseBranch);
    const head = branch ? await fetchBranch(repo, branch) : null;
    await bundleBase(repo, outFile, baseBranch, head ? branch! : undefined);
    return { base, head };
  });
}

/** Imports the branch from a bundle the sandbox made (`base..branch`) and pushes it to GitHub. */
export function importAndPush(repo: string, bundleFile: string, branch: string): Promise<string> {
  return withMirror(repo, async () => {
    const dir = mirrorDir(repo);
    await git(["bundle", "verify", "--quiet", bundleFile], { cwd: dir });
    await git(["fetch", "--quiet", bundleFile, `+refs/heads/${branch}:refs/heads/${branch}`], { cwd: dir });
    await git(["push", "--quiet", "origin", `refs/heads/${branch}:refs/heads/${branch}`], {
      cwd: dir,
      auth: true,
    });
    return git(["rev-parse", `refs/heads/${branch}`], { cwd: dir });
  });
}
