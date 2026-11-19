import { config } from "./config.ts";
import type { PrComment, ReviewThread } from "./feedback.ts";

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
  return (await res.json()) as T;
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
