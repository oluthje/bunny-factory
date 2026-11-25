// The part of a failed CI job's log that fix-ci's prompt carries: the lines up to the job's last
// error, cleaned of GitHub's timestamps and terminal colours. Pure: no I/O, so it is unit-tested in
// logs.test.ts.

/** GitHub Actions prefixes every log line with its time. */
const TIMESTAMP = /^\d{4}-\d\d-\d\dT[\d:.]+Z ?/;
const ANSI = /\x1b\[[0-9;]*m/g;
/** How GitHub Actions marks the step that failed the job. */
const ERROR_MARK = "##[error]";

/**
 * Up to `maxLines` lines ending at the last `##[error]` line, or the log's end when it has none:
 * a job's log goes on past its failure with cleanup steps that say nothing about it. Cut to its
 * last `maxChars` when longer.
 */
export function logExcerpt(raw: string, maxLines = 120, maxChars = 12_000): string {
  const lines = raw.split(/\r?\n/).map((l) => l.replace(TIMESTAMP, "").replace(ANSI, "").trimEnd());
  let end = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.includes(ERROR_MARK)) {
      end = i + 1;
      break;
    }
  }
  const excerpt = lines.slice(Math.max(0, end - maxLines), end).join("\n").trim();
  return excerpt.length > maxChars ? `…${excerpt.slice(-maxChars)}` : excerpt;
}
