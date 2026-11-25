// Evidence: the screenshots and recordings the agent referenced in its PR body, uploaded to
// Linear. The ticket shows them inline; the PR links to them.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { uploadFile } from "./linear.ts";
import { evidenceRefs } from "./logic.ts";

const CONTENT_TYPES: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/plain",
  ".log": "text/plain",
  ".json": "application/json",
  ".rb": "text/plain",
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

/** A video, which Linear links rather than shows inline. */
export const isVideo = (file: string) => /\.(webm|mp4)$/i.test(file);
/** An image, which Linear shows inline. */
export const isImage = (file: string) => /\.(png|jpe?g|gif)$/i.test(file);

/** A file uploaded to Linear: its asset URL, and the name it went up under (a `.gif` reference uploads its `.webm`). */
export type Uploaded = { url: string; name: string };

/**
 * Uploads each named file from the run's evidence directory to Linear, once. Returns each
 * reference's upload, without the files the run never wrote.
 */
export async function uploadEvidence(runDir: string, files: readonly string[]): Promise<Record<string, Uploaded>> {
  const dir = await extractEvidence(runDir);
  const uploads: Record<string, Uploaded> = {};
  for (const file of new Set(files)) {
    const local = resolve(dir, file);
    if (!local) continue;
    const name = path.basename(local);
    const ext = path.extname(local).toLowerCase();
    uploads[file] = { url: await uploadFile(fs.readFileSync(local), name, CONTENT_TYPES[ext] ?? "application/octet-stream"), name };
  }
  return uploads;
}

export async function publishEvidence(runDir: string, prBody: string): Promise<PublishedEvidence> {
  const refs = evidenceRefs(prBody);
  const uploads = await uploadEvidence(runDir, refs.map((r) => r.file));
  const urls: Record<string, string> = {};
  const lines = refs.flatMap(({ alt, file }) => {
    const up = uploads[file];
    if (!up) return [];
    urls[file] = up.url;
    return [isVideo(up.name) ? `[▶ ${alt}](${up.url})` : `**${alt}**\n\n![${alt}](${up.url})`];
  });
  return { urls, linearMarkdown: lines.length ? `### Evidence\n\n${lines.join("\n\n")}` : "" };
}
