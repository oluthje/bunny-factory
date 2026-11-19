// review's placeholders in prompt.md: where to write the review, and the open PR's body as context.
// Pure: no I/O, so it is unit-tested in prompt.test.ts.
import { GITHUB_MARKER } from "../../src/logic.ts";
import { artifact } from "../../src/runner-paths.ts";

/** Where the agent writes its review. */
export const REVIEW = artifact("review.md");

/** `prBody` is the open PR's body, or null with none: context next to the ticket, which stays the spec. */
export function promptVars(prBody: string | null): Record<string, string> {
  return {
    reviewPath: REVIEW,
    prContext: prBody?.trim()
      ? `## The PR body\n\nContext, not the spec: the implementer's account of the PR, with its Decisions and Gaps. Check what it claims against the code. A Decision recording that Oscar asked for a change that departs from the ticket is not a spec failure: judge that part against the request.\n\n<pr-body>\n${prBody.replaceAll(GITHUB_MARKER, "").trim()}\n</pr-body>`
      : "",
  };
}
