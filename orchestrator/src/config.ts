import path from "node:path";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export const config = {
  /** Run folders, git mirrors and the SQLite file. A Fly volume in production. */
  dataDir: path.resolve(process.env.DATA_DIR ?? "./data"),
  port: Number(process.env.PORT ?? 3000),

  linearTeam: process.env.FACTORY_TEAM ?? "REC",

  githubOwner: process.env.GITHUB_OWNER ?? "bunnyapp",
  /** Repos bundled into every run. Order matters only for logs. */
  repos: (process.env.FACTORY_REPOS ?? "api,app,portal,kong").split(","),
  baseBranch: "main",
  draftPrs: (process.env.FACTORY_DRAFT_PRS ?? "true") === "true",
  /**
   * The factory says which PRs it would merge, and merges none. Anything but "false" keeps it on,
   * so a typo never starts merging.
   */
  mergeDryRun: (process.env.FACTORY_MERGE_DRY_RUN ?? "true") !== "false",

  /** The time zone clock triggers fire in, and the one a ticket the factory files is dated in. */
  timeZone: process.env.FACTORY_TZ ?? "America/Los_Angeles",

  snapshot: () => required("FACTORY_SNAPSHOT"),
  claudeSecret: process.env.CLAUDE_SECRET ?? "claude-oauth-token",
  /** How long Claude may run before the factory gives up. */
  claudeTimeoutMinutes: Number(process.env.CLAUDE_TIMEOUT_MINUTES ?? 60),
  pollSeconds: 30,
  /**
   * The most runs in flight at once, across all tickets. Each runner takes the snapshot's 4 vCPU and
   * 8 GiB, so Daytona's tier 2 allows about 25; the shared Claude subscription's rate limits bind first.
   */
  maxRuns: Number(process.env.FACTORY_MAX_RUNS ?? 3),

  /**
   * `on` lets this machine start runs; anything else, or unset, starts none. Set only as a Fly
   * secret, so a laptop never starts runs. `fac stop` (scripts/factory.ts) stops a machine that has it.
   */
  poll: process.env.FACTORY_POLL,
  /** The commit the image was built from, and when it was deployed: set by the Dockerfile. */
  deploy: { commit: process.env.FACTORY_COMMIT ?? null, at: process.env.FACTORY_DEPLOYED_AT ?? null },
  /** The day GH_TOKEN, a fine-grained PAT, expires (docs/services.md, decision 7). */
  patExpires: process.env.GH_TOKEN_EXPIRES ?? "2026-12-17",

  ghToken: () => required("GH_TOKEN"),
  linearApiKey: () => required("LINEAR_API_KEY"),
  daytonaApiKey: () => required("DAYTONA_API_KEY"),
};
