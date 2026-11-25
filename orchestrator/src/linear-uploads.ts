// Linear uploads in a run's prompt: screenshots and mockups in the ticket, its comments, or a PR body
// that links evidence. `uploads.linear.app` serves them only with the Linear API key, which the
// runner never holds, so the orchestrator downloads them (linear.ts) and run-ticket.ts hands the
// runner local copies. Pure: no I/O, so it is unit-tested in test/linear-uploads.test.ts.
import { RUN_DIR } from "./runner-paths.ts";

/** Where the runner finds the copies. */
export const UPLOADS_DIR = `${RUN_DIR}/linear-uploads`;
/** The most uploads one run gets; the rest stay links. */
export const MAX_UPLOADS = 20;
/** The largest upload a run gets, in bytes; a bigger one stays a link. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Ends at whitespace, or at whatever closes Markdown, HTML or a JSON string around the URL. */
const UPLOAD_URL = /https:\/\/uploads\.linear\.app\/[^\s)"'<>\\\]]+/g;

/** Every Linear upload the text links, each once, in order, at most MAX_UPLOADS. */
export function linearUploadUrls(text: string): string[] {
  return [...new Set(text.match(UPLOAD_URL) ?? [])].slice(0, MAX_UPLOADS);
}

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "video/webm": "webm",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "application/pdf": "pdf",
};

/** The runner path of the `n`th upload (from 1), its extension from its content type. */
export function uploadPath(n: number, contentType: string | null): string {
  const ext = EXTENSIONS[(contentType ?? "").split(";")[0]!.trim().toLowerCase()] ?? "bin";
  return `${UPLOADS_DIR}/${n}.${ext}`;
}

/** The text with each downloaded upload's URL pointed at its runner path; the rest stay as they are. */
export function localizeUploads(text: string, paths: Record<string, string>): string {
  return text.replace(UPLOAD_URL, (url) => paths[url] ?? url);
}
