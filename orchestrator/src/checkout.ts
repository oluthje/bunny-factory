// The orchestrator's own source checkout: refuses to start when it is behind its upstream, so a
// merge on the git host never sits unpulled while the factory runs the old code. The decision is
// `staleCheckoutRefusal` in logic.ts; this module only does the git I/O. A deploy that isn't a git
// checkout (the Fly image) skips the check.
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { staleCheckoutRefusal } from "./logic.ts";

const run = promisify(execFile);
const sourceDir = path.dirname(fileURLToPath(import.meta.url));

async function git(args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd: sourceDir });
  return stdout.trim();
}

/** Throws when the checkout is behind its upstream and FACTORY_ALLOW_STALE isn't set. */
export async function assertCheckoutCurrent(): Promise<void> {
  try {
    await git(["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return; // not a git checkout: nothing to compare
  }
  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  try {
    await git(["fetch", "--quiet", "origin", branch]);
  } catch (err) {
    console.warn(`Couldn't fetch origin/${branch} to check this checkout is current: ${(err as Error).message}`);
    return;
  }
  const behind = Number(await git(["rev-list", "--count", `HEAD..origin/${branch}`]));
  const refusal = staleCheckoutRefusal(behind, branch, process.env.FACTORY_ALLOW_STALE === "1");
  if (refusal) throw new Error(refusal);
}
