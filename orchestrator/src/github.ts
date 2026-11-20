import { config } from "./config.ts";
import type { PrComment, ReviewThread } from "./comments.ts";
import type { CheckRun, CommitStatus } from "./checks.ts";

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

/** Opens a PR for the branch, or returns the open one. */
export async function openOrFindPr(repo: string, branch: string, title: string, body: string): Promise<string> {
  const open = await findOpenPr(repo, branch);
  if (open) return open;
  const pr = await gh<{ html_url: string }>("POST", `/repos/${config.githubOwner}/${repo}/pulls`, {
    title,
    body,
    head: branch,
    base: config.baseBranch,
    draft: config.draftPrs,
  });
  return pr.html_url;
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

/** Marks a draft PR ready for review, once review has been through it; a no-op when it already is. */
export async function markReady(url: string): Promise<void> {
  const { repo, number } = parsePrUrl(url);
  const pr = await gh<{ node_id: string; draft: boolean }>("GET", `/repos/${config.githubOwner}/${repo}/pulls/${number}`);
  if (!pr.draft) return;
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
};

/**
 * The PR as GitHub sees it now. GitHub works out whether a PR can merge only when asked, so a
 * first answer of `mergeable: null` is asked again, a few seconds apart.
 */
export async function prState(url: string): Promise<PrState> {
  const { repo, number } = parsePrUrl(url);
  type Pr = { draft: boolean; mergeable: boolean | null; mergeable_state: string; state: string; base: { ref: string }; head: { sha: string } };
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
 * Merges the PR with a merge commit, only if its head is still `sha`: anything pushed since makes
 * GitHub refuse, rather than merge code nobody judged.
 */
export async function mergePr(url: string, sha: string): Promise<void> {
  const { repo, number } = parsePrUrl(url);
  await gh("PUT", `/repos/${config.githubOwner}/${repo}/pulls/${number}/merge`, { sha, merge_method: "merge" });
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
