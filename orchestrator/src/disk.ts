// The data volume (`config.dataDir`, `/data` on Fly): its free space, and the run folders under
// `runs/` that sweep-runs (functions/sweep-runs.ts) prunes. Which folders go is decided by
// `runFoldersToPrune` in logic.ts; this module only measures and deletes. It never touches the
// mirrors or factory.db, which live beside `runs/`.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "./config.ts";
import type { RunFolder, VolumeSpace } from "./logic.ts";

const runsDir = () => path.join(config.dataDir, "runs");

/** The volume's size and the bytes free to use on it. */
export function volumeSpace(): VolumeSpace {
  const s = fs.statfsSync(config.dataDir);
  return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
}

/** Every run folder, aged by its last change (a run's last write is its artifacts), with its size. */
export async function runFolders(): Promise<RunFolder[]> {
  if (!fs.existsSync(runsDir())) return [];
  const { stdout } = await promisify(execFile)("du", ["-k", "-d", "1", runsDir()], { maxBuffer: 16 * 1024 * 1024 });
  const kb = new Map(
    stdout.split("\n").flatMap((line) => {
      const m = /^(\d+)\s+(.+)$/.exec(line);
      return m ? [[path.basename(m[2]!), Number(m[1]) * 1024] as const] : [];
    }),
  );
  return fs.readdirSync(runsDir(), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ id: d.name, at: fs.statSync(path.join(runsDir(), d.name)).mtimeMs, bytes: kb.get(d.name) ?? 0 }));
}

/** Deletes one run's folder. `id` is a folder name from `runFolders`, never a path. */
export function deleteRunFolder(id: string): void {
  if (id !== path.basename(id) || id === "." || id === "..") throw new Error(`Not a run folder: ${id}`);
  fs.rmSync(path.join(runsDir(), id), { recursive: true, force: true });
}
