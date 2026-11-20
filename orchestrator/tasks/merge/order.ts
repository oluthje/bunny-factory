// The order a ticket's PRs merge in. On staging, the order matters for a few minutes: an app that
// lands before the api field it reads breaks until the api lands. Pure: no I/O, so it is
// unit-tested in order.test.ts.

/** The usual case: the backend adds something, then the frontends use it. */
export const DEFAULT_ORDER = ["api", "app", "portal", "kong"];

/**
 * The agent's order when it names every repo exactly once; otherwise the default, with any repo it
 * doesn't know last, by name.
 */
export function mergeOrder(requested: readonly string[], repos: readonly string[]): string[] {
  const exact = requested.length === repos.length && new Set(requested).size === repos.length && requested.every((r) => repos.includes(r));
  if (exact) return [...requested];
  const rank = (r: string) => {
    const i = DEFAULT_ORDER.indexOf(r);
    return i === -1 ? DEFAULT_ORDER.length : i;
  };
  return [...repos].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
