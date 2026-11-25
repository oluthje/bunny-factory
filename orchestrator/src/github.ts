import { config } from "./config.ts";
import type { PrComment, ReviewThread } from "./comments.ts";
import { PASSED, type CheckRun, type CommitStatus, type FailedCheck } from "./checks.ts";

async function gh<T>(method: string, pathname: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.github.com${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.ghToken()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "bunny-factory",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${pathname}: ${res.status} ${await res.text()}`);
  // A DELETE answers 204 with no body.
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Commit identity for the sandbox: the PAT owner's noreply address, so no real email leaks. */
export async function commitIdentity(): Promise<{ name: string; email: string }> {
  const me = await gh<{ id: number; login: string; name: string | null }>("GET", "/user");
  return { name: me.name ?? me.login, email: `${me.id}+${me.login}@users.noreply.github.com` };
}

/**
 * Opens a PR for the branch into `base`, or returns the open one. A base that isn't on GitHub yet
 * (a bulk branch no sub-ticket has used in this repo) is created first, from main's head.
 */
export async function openOrFindPr(
  repo: string,
  branch: string,
  title: string,
  body: string,
  base: string = config.baseBranch,
  draft: boolean = config.draftPrs,
): Promise<string> {
  const open = await findOpenPr(repo, branch);
  if (open) return open;
  if (base !== config.baseBranch && !(await branchSha(repo, base))) {
    const main = await branchSha(repo, config.baseBranch);
    if (!main) throw new Error(`${repo} has no \`${config.baseBranch}\` to start \`${base}\` from`);
    // Another run may create it first: 422, "Reference already exists", is as good.
    await gh("POST", `/repos/${config.githubOwner}/${repo}/git/refs`, { ref: `refs/heads/${base}`, sha: main }).catch((err) => {
      if (!(err instanceof Error && /: 422 /.test(err.message))) throw err;
    });
  }
  const pr = await gh<{ html_url: string }>("POST", `/repos/${config.githubOwner}/${repo}/pulls`, { title, body, head: branch, base, draft });
  return pr.html_url;
}

/** The branch's head on GitHub, or null when the repo has no such branch. */
export async function branchSha(repo: string, branch: string): Promise<string | null> {
  try {
    return (await gh<{ object: { sha: string } }>("GET", `/repos/${config.githubOwner}/${repo}/git/ref/heads/${branch}`)).object.sha;
  } catch (err) {
    if (err instanceof Error && /: 404 /.test(err.message)) return null;
    throw err;
  }
}

/** Which of the branches are on GitHub in at least one of the factory's repos. */
export async function branchesOnGitHub(names: readonly string[]): Promise<string[]> {
  const found: string[] = [];
  for (const name of names) {
    for (const repo of config.repos) {
      if (await branchSha(repo, name)) {
        found.push(name);
        break;
      }
    }
  }
  return found;
}

/** Every branch in the repo whose name starts with `prefix`. Up to 100. */
export async function branchesWithPrefix(repo: string, prefix: string): Promise<string[]> {
  const refs = await gh<{ ref: string }[]>("GET", `/repos/${config.githubOwner}/${repo}/git/matching-refs/heads/${prefix}?per_page=100`);
  return refs.map((r) => r.ref.replace(/^refs\/heads\//, ""));
}

/** How many commits `head` has that `base` hasn't. */
export async function aheadBy(repo: string, base: string, head: string): Promise<number> {
  return (await gh<{ ahead_by: number }>("GET", `/repos/${config.githubOwner}/${repo}/compare/${base}...${head}`)).ahead_by;
}

/** The newest PR from `head` into `base`, open or not, or null when there was never one. */
export async function latestPr(
  repo: string,
  head: string,
  base: string,
): Promise<{ url: string; state: "open" | "merged" | "closed"; draft: boolean; headSha: string } | null> {
  const owner = config.githubOwner;
  const prs = await gh<{ html_url: string; state: string; merged_at: string | null; draft: boolean; head: { sha: string } }[]>(
    "GET",
    `/repos/${owner}/${repo}/pulls?state=all&sort=created&direction=desc&base=${encodeURIComponent(base)}&head=${encodeURIComponent(`${owner}:${head}`)}`,
  );
  const pr = prs[0];
  if (!pr) return null;
  return { url: pr.html_url, state: pr.state === "open" ? "open" : pr.merged_at ? "merged" : "closed", draft: pr.draft, headSha: pr.head.sha };
}

/** The open PR for the branch, or null. */
export async function findOpenPr(repo: string, branch: string): Promise<string | null> {
  const owner = config.githubOwner;
  const open = await gh<{ html_url: string }[]>(
    "GET",
    `/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`,
  );
  return open[0]?.html_url ?? null;
}

/** GitHub caps comment bodies at 65,536 characters. */
const MAX_COMMENT = 65_000;

/**
 * One review with event COMMENT (no approval or change request: the PRs are opened as the token's
 * owner, who can't request changes on their own PR), with an inline comment per finding.
 * Every comment must be on a line inside the diff, or GitHub rejects the whole review.
 */
export async function postReview(
  url: string,
  commitId: string,
  body: string,
  comments: { path: string; line: number; body: string }[],
): Promise<void> {
  const { repo, number } = parsePrUrl(url);
  const text = body.length > MAX_COMMENT ? `${body.slice(0, MAX_COMMENT)}\n\n_(truncated)_` : body;
  await gh("POST", `/repos/${config.githubOwner}/${repo}/pulls/${number}/reviews`, {
    commit_id: commitId,
    event: "COMMENT",
    body: text,
    comments: comments.map(({ path, line, body }) => ({ path, line, side: "RIGHT", body })),
  });
}

function parsePrUrl(url: string): { repo: string; number: number } {
  const m = /github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/.exec(url);
  if (!m) throw new Error(`not a PR URL: ${url}`);
  return { repo: m[1]!, number: Number(m[2]) };
}

/** The paths a PR adds, a rename's new path included. Up to GitHub's 3000 files. */
export async function prAddedFiles(url: string): Promise<string[]> {
  const { repo, number } = parsePrUrl(url);
  const added: string[] = [];
  for (let page = 1; page <= 30; page++) {
    const files = await gh<{ filename: string; status: string }[]>(
      "GET",
      `/repos/${config.githubOwner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`,
    );
    added.push(...files.filter((f) => f.status === "added" || f.status === "renamed").map((f) => f.filename));
    if (files.length < 100) break;
  }
  return added;
}

/** Every file under `dir` on `branch`, as paths from the repo's root. Empty when the directory isn't there. */
export async function filesUnder(repo: string, branch: string, dir: string): Promise<string[]> {
  try {
    const tree = await gh<{ tree: { path: string; type: string }[]; truncated: boolean }>(
      "GET",
      `/repos/${config.githubOwner}/${repo}/git/trees/${encodeURIComponent(`${branch}:${dir}`)}?recursive=1`,
    );
    if (tree.truncated) throw new Error(`GitHub truncated the tree of ${repo} ${branch}:${dir}`);
    return tree.tree.filter((e) => e.type === "blob").map((e) => `${dir}/${e.path}`);
  } catch (err) {
    if (err instanceof Error && /: 404 /.test(err.message)) return [];
    throw err;
  }
}

export async function getPrBody(url: string): Promise<string> {
  const { repo, number } = parsePrUrl(url);
  const pr = await gh<{ body: string | null }>("GET", `/repos/${config.githubOwner}/${repo}/pulls/${number}`);
  return pr.body ?? "";
}

export async function setPrBody(url: string, body: string): Promise<void> {
  const { repo, number } = parsePrUrl(url);
  await gh("PATCH", `/repos/${config.githubOwner}/${repo}/pulls/${number}`, { body });
}

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await gh<{ data?: T; errors?: { message: string }[] }>("POST", "/graphql", { query, variables });
  if (res.errors?.length || !res.data) throw new Error(`GitHub GraphQL: ${res.errors?.map((e) => e.message).join("; ") ?? "no data"}`);
  return res.data;
}

/** The PAT owner's login: Oscar, and also the author of everything the factory posts. */
export async function viewerLogin(): Promise<string> {
  return (await gh<{ login: string }>("GET", "/user")).login;
}

/** The PR's review threads, oldest comment first. Up to 100 threads of 100 comments each. */
export async function reviewThreads(url: string): Promise<ReviewThread[]> {
  const { repo, number } = parsePrUrl(url);
  const data = await graphql<{
    repository: {
      pullRequest: {
        reviewThreads: {
          nodes: {
            id: string;
            isResolved: boolean;
            path: string;
            line: number | null;
            comments: { nodes: { body: string; createdAt: string; author: { login: string } | null }[] };
          }[];
        };
      };
    };
  }>(
    `query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          reviewThreads(first: 100) {
            nodes { id isResolved path line comments(first: 100) { nodes { body createdAt author { login } } } }
          }
        }
      }
    }`,
    { owner: config.githubOwner, repo, number },
  );
  return data.repository.pullRequest.reviewThreads.nodes.map((t) => ({
    id: t.id,
    repo,
    path: t.path,
    line: t.line,
    isResolved: t.isResolved,
    comments: t.comments.nodes.map((c) => ({ author: c.author?.login ?? "ghost", body: c.body, createdAt: c.createdAt })),
  }));
}

/** The PR's conversation comments (not review threads), oldest first. Up to 100. */
export async function prComments(url: string): Promise<PrComment[]> {
  const { repo, number } = parsePrUrl(url);
  const list = await gh<{ body: string | null; created_at: string; user: { login: string } | null }[]>(
    "GET",
    `/repos/${config.githubOwner}/${repo}/issues/${number}/comments?per_page=100`,
  );
  return list.map((c) => ({ repo, author: c.user?.login ?? "ghost", body: c.body ?? "", createdAt: c.created_at }));
}

export async function replyToThread(threadId: string, body: string): Promise<void> {
  await graphql(
    `mutation($id: ID!, $body: String!) {
      addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $id, body: $body }) { comment { id } }
    }`,
    { id: threadId, body },
  );
}

/** Whether the PR is still open: Oscar may close one while a run that found it open is in flight. */
export async function isPrOpen(url: string): Promise<boolean> {
  const { repo, number } = parsePrUrl(url);
  return (await gh<{ state: string }>("GET", `/repos/${config.githubOwner}/${repo}/pulls/${number}`)).state === "open";
}

/**
 * Marks a draft PR ready for review, once review has been through it; a no-op when it already is,
 * or when it's closed (GitHub refuses a closed one, calling it a permission error).
 */
export async function markReady(url: string): Promise<void> {
  const { repo, number } = parsePrUrl(url);
  const pr = await gh<{ node_id: string; draft: boolean; state: string }>("GET", `/repos/${config.githubOwner}/${repo}/pulls/${number}`);
  if (!pr.draft || pr.state !== "open") return;
  await graphql(`mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { clientMutationId } }`, {
    id: pr.node_id,
  });
}

/** The PR's reviews that have a body, oldest first: the factory's own review is one. Up to 100. */
export async function prReviews(url: string): Promise<PrComment[]> {
  const { repo, number } = parsePrUrl(url);
  const list = await gh<{ body: string | null; submitted_at: string | null; user: { login: string } | null }[]>(
    "GET",
    `/repos/${config.githubOwner}/${repo}/pulls/${number}/reviews?per_page=100`,
  );
  return list
    .filter((r) => r.body?.trim())
    .map((r) => ({ repo, author: r.user?.login ?? "ghost", body: r.body!, createdAt: r.submitted_at ?? "" }));
}

export type PrState = {
  repo: string;
  draft: boolean;
  /** False when it conflicts with its base; null while GitHub is still working it out. */
  mergeable: boolean | null;
  /** GitHub's `mergeable_state`: `clean`, `unstable`, `has_hooks`, `behind`, `blocked`, `dirty`, `draft` or `unknown`. */
  mergeableState: string;
  base: string;
  headSha: string;
  open: boolean;
  merged: boolean;
};

/**
 * The PR as GitHub sees it now. GitHub works out whether a PR can merge only when asked, so a
 * first answer of `mergeable: null` is asked again, a few seconds apart.
 */
export async function prState(url: string): Promise<PrState> {
  const { repo, number } = parsePrUrl(url);
  type Pr = {
    draft: boolean;
    mergeable: boolean | null;
    mergeable_state: string;
    state: string;
    merged: boolean;
    base: { ref: string };
    head: { sha: string };
  };
  let pr = await gh<Pr>("GET", `/repos/${config.githubOwner}/${repo}/pulls/${number}`);
  for (let i = 0; pr.mergeable === null && i < 4; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    pr = await gh<Pr>("GET", `/repos/${config.githubOwner}/${repo}/pulls/${number}`);
  }
  return {
    repo,
    draft: pr.draft,
    mergeable: pr.mergeable,
    mergeableState: pr.mergeable_state,
    base: pr.base.ref,
    headSha: pr.head.sha,
    open: pr.state === "open",
    merged: pr.merged,
  };
}

/** Every check run (the latest of each) and commit status on the commit. Up to 100 of each. */
export async function commitChecks(repo: string, sha: string): Promise<{ runs: CheckRun[]; statuses: CommitStatus[] }> {
  const owner = config.githubOwner;
  const runs = await gh<{ check_runs: { name: string; status: string; conclusion: string | null }[] }>(
    "GET",
    `/repos/${owner}/${repo}/commits/${sha}/check-runs?filter=latest&per_page=100`,
  );
  const combined = await gh<{ statuses: { context: string; state: string }[] }>(
    "GET",
    `/repos/${owner}/${repo}/commits/${sha}/status?per_page=100`,
  );
  return {
    runs: runs.check_runs.map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion })),
    statuses: combined.statuses.map((s) => ({ context: s.context, state: s.state })),
  };
}

/**
 * Every check that failed on the commit (the latest run of each name), with why: its summary, and
 * for a GitHub Actions job its raw log, or null when the log can't be read (expired, or not Actions).
 */
export async function failedChecks(repo: string, sha: string): Promise<FailedCheck[]> {
  const owner = config.githubOwner;
  type Run = {
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    html_url: string | null;
    app: { slug: string } | null;
    output: { title: string | null; summary: string | null; text: string | null };
  };
  const runs = await gh<{ check_runs: Run[] }>("GET", `/repos/${owner}/${repo}/commits/${sha}/check-runs?filter=latest&per_page=100`);
  const combined = await gh<{ statuses: { context: string; state: string; target_url: string | null; description: string | null }[] }>(
    "GET",
    `/repos/${owner}/${repo}/commits/${sha}/status?per_page=100`,
  );
  const failedRuns = runs.check_runs.filter((r) => r.status === "completed" && !PASSED.includes(r.conclusion ?? ""));
  return [
    ...(await Promise.all(
      failedRuns.map(async (r) => ({
        name: r.name,
        url: r.html_url,
        summary: [r.output.title, r.output.summary, r.output.text].filter(Boolean).join("\n\n"),
        log: r.app?.slug === "github-actions" ? await jobLog(repo, r.id).catch(() => null) : null,
      })),
    )),
    ...combined.statuses
      .filter((s) => s.state === "failure" || s.state === "error")
      .map((s) => ({ name: s.context, url: s.target_url, summary: s.description ?? "", log: null })),
  ];
}

/** A GitHub Actions job's raw log: its check run's id is the job's. GitHub answers with a redirect to the file. */
async function jobLog(repo: string, jobId: number): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${config.githubOwner}/${repo}/actions/jobs/${jobId}/logs`, {
    headers: { Authorization: `Bearer ${config.ghToken()}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "bunny-factory" },
  });
  if (!res.ok) throw new Error(`GitHub job log ${repo}/${jobId}: ${res.status}`);
  return res.text();
}

/**
 * Merges the PR, with a merge commit unless told to squash, only if its head is still `sha`:
 * anything pushed since makes GitHub refuse, rather than merge code nobody judged.
 */
export type MergeMethod = "merge" | "squash";

export async function mergePr(url: string, sha: string, method: MergeMethod = "merge"): Promise<void> {
  const { repo, number } = parsePrUrl(url);
  await gh("PUT", `/repos/${config.githubOwner}/${repo}/pulls/${number}/merge`, { sha, merge_method: method });
}

/** Deletes the branch; a no-op when the repo already deleted it on merge. */
export async function deleteBranch(repo: string, branch: string): Promise<void> {
  try {
    await gh("DELETE", `/repos/${config.githubOwner}/${repo}/git/refs/heads/${branch}`);
  } catch (err) {
    // 422 "Reference does not exist": the repo deletes merged branches itself.
    if (!(err instanceof Error && /: 422 /.test(err.message))) throw err;
  }
}

/** A conversation comment on the PR. */
export async function commentOnPr(url: string, body: string): Promise<void> {
  const { repo, number } = parsePrUrl(url);
  await gh("POST", `/repos/${config.githubOwner}/${repo}/issues/${number}/comments`, { body });
}
