// Host-side git: bare mirrors of the Bunny repos on the data volume. Code enters and leaves
// sandboxes only as git bundles, so the PAT stays here.
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

export function mirrorDir(repo: string): string {
  return path.join(config.dataDir, "mirrors", `${repo}.git`);
}

function remoteUrl(repo: string): string {
  return `https://github.com/${config.githubOwner}/${repo}.git`;
}

/** Clones the mirror on first use, then fetches the base branch. Returns its sha. */
export async function refreshMirror(repo: string): Promise<string> {
  const dir = mirrorDir(repo);
  const base = config.baseBranch;
  if (!fs.existsSync(path.join(dir, "HEAD"))) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await git(["clone", "--bare", "--single-branch", "--branch", base, remoteUrl(repo), dir], { auth: true });
  } else {
    await git(["fetch", "--quiet", "--no-tags", "origin", `+refs/heads/${base}:refs/heads/${base}`], {
      cwd: dir,
      auth: true,
    });
  }
  return git(["rev-parse", `refs/heads/${base}`], { cwd: dir });
}

/**
 * Fetches a work branch from GitHub into the mirror, for a run that reviews it.
 * Returns its sha, or null when the repo has no such branch.
 */
export async function fetchBranch(repo: string, branch: string): Promise<string | null> {
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
export async function branchDiff(repo: string, branch: string): Promise<string> {
  return git(
    ["diff", "--no-color", "--no-ext-diff", `refs/heads/${config.baseBranch}...refs/heads/${branch}`],
    { cwd: mirrorDir(repo) },
  );
}

/**
 * A full bundle of the base branch, plus the work branch when given. Full, because the sandbox's
 * clones are partial (blob:none).
 */
export async function bundleBase(repo: string, outFile: string, branch?: string): Promise<void> {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const refs = [`refs/heads/${config.baseBranch}`, ...(branch ? [`refs/heads/${branch}`] : [])];
  await git(["bundle", "create", outFile, ...refs], { cwd: mirrorDir(repo) });
}

/** Imports the branch from a bundle the sandbox made (`main..branch`) and pushes it to GitHub. */
export async function importAndPush(repo: string, bundleFile: string, branch: string): Promise<string> {
  const dir = mirrorDir(repo);
  await git(["bundle", "verify", "--quiet", bundleFile], { cwd: dir });
  await git(["fetch", "--quiet", bundleFile, `+refs/heads/${branch}:refs/heads/${branch}`], { cwd: dir });
  await git(["push", "--quiet", "origin", `refs/heads/${branch}:refs/heads/${branch}`], {
    cwd: dir,
    auth: true,
  });
  return git(["rev-parse", `refs/heads/${branch}`], { cwd: dir });
}
