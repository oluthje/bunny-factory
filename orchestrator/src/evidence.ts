// Evidence: the screenshots and recordings the agent referenced in its PR body, uploaded to
// Linear. The ticket shows them inline; the PR links to them.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { uploadFile } from "./linear.ts";
import { evidenceRefs } from "./logic.ts";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
};

/** Unpacks `artifacts/evidence/` from the run's artifacts.tgz and returns its directory. */
export async function extractEvidence(runDir: string): Promise<string> {
  const dir = path.join(runDir, "artifacts", "evidence");
  if (!fs.existsSync(dir)) {
    await promisify(execFile)("tar", ["xzf", path.join(runDir, "artifacts.tgz"), "-C", runDir, "artifacts/evidence"]).catch(
      () => undefined, // a run with no evidence has no such folder
    );
  }
  return dir;
}

/**
 * The file to upload for a reference. Runs now reference their `.webm` recordings directly; a `.gif`
 * reference, from runs and backfills made before that, falls back to the `.webm` beside it.
 */
function resolve(dir: string, file: string): string | null {
  const exact = path.join(dir, file);
  if (fs.existsSync(exact)) return exact;
  const webm = exact.replace(/\.gif$/i, ".webm");
  return webm !== exact && fs.existsSync(webm) ? webm : null;
}

export type PublishedEvidence = {
  /** Referenced file name → Linear asset URL. */
  urls: Record<string, string>;
  /** Markdown for the Linear comment: images inline, videos as links. */
  linearMarkdown: string;
};

export async function publishEvidence(runDir: string, prBody: string): Promise<PublishedEvidence> {
  const dir = await extractEvidence(runDir);
  const urls: Record<string, string> = {};
  const lines: string[] = [];
  for (const { alt, file } of evidenceRefs(prBody)) {
    const local = resolve(dir, file);
    if (!local) continue;
    const ext = path.extname(local).toLowerCase();
    const url = await uploadFile(fs.readFileSync(local), path.basename(local), CONTENT_TYPES[ext] ?? "application/octet-stream");
    urls[file] = url;
    lines.push(ext === ".webm" || ext === ".mp4" ? `[▶ ${alt}](${url})` : `**${alt}**\n\n![${alt}](${url})`);
  }
  return { urls, linearMarkdown: lines.length ? `### Evidence\n\n${lines.join("\n\n")}` : "" };
}
