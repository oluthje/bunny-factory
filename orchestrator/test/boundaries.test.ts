// The rules in docs/coding-standards.md ("Where code lives") that a test can check: the engine in
// src/ knows tasks only through the registry, and a task never reaches into another task's run
// code or the registry. Test files may import anything.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(import.meta.dirname, "..");
const TASKS_DIR = path.join(ROOT, "tasks");
const REGISTRY = path.join(TASKS_DIR, "index.ts");

/** Every non-test .ts file under `dir`. */
function sources(dir: string): string[] {
  return fs.readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => path.join(dir, f));
}

/** Each relative import in `file`, resolved to an absolute path. */
function imports(file: string): string[] {
  const text = fs.readFileSync(file, "utf8");
  return [...text.matchAll(/^\s*(?:import|export)\b[^"']*?from\s+["'](\.[^"']+)["']/gm)].map((m) => path.resolve(path.dirname(file), m[1]!));
}

const taskOf = (file: string) => (file.startsWith(TASKS_DIR + path.sep) ? path.relative(TASKS_DIR, file).split(path.sep)[0]! : null);
const rel = (file: string) => path.relative(ROOT, file);

describe("module boundaries", () => {
  it("src/ imports from tasks/ only through the registry", () => {
    const bad = sources(path.join(ROOT, "src")).flatMap((file) =>
      imports(file)
        .filter((dep) => dep.startsWith(TASKS_DIR + path.sep) && dep !== REGISTRY)
        .map((dep) => `${rel(file)} → ${rel(dep)}`),
    );
    expect(bad).toEqual([]);
  });

  it("no task imports the registry, the engine's view of it, or another task's index.ts", () => {
    const engineViews = ["src/tasks.ts", "src/functions"].map((p) => path.join(ROOT, p));
    const taskFiles = sources(TASKS_DIR).filter((f) => f !== REGISTRY);
    const bad = taskFiles.flatMap((file) =>
      imports(file)
        .filter((dep) => {
          // A type-only import of TaskName from the registry is fine: it emits nothing.
          if (dep === REGISTRY) return !/import type \{[^}]*\} from ["']\.\.\/index\.ts["']/.test(fs.readFileSync(file, "utf8"));
          if (engineViews.some((v) => dep === v || dep.startsWith(v + path.sep))) return true;
          const other = taskOf(dep);
          return other !== null && other !== taskOf(file) && path.basename(dep) === "index.ts";
        })
        .map((dep) => `${rel(file)} → ${rel(dep)}`),
    );
    expect(bad).toEqual([]);
  });
});
