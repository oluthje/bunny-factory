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

  ghToken: () => required("GH_TOKEN"),
  linearApiKey: () => required("LINEAR_API_KEY"),
  daytonaApiKey: () => required("DAYTONA_API_KEY"),
};
