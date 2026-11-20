The review is written. Now hand back, as structured output:

- Every finding you left, not the ones under `## Fixed`, that points at a file and line: one entry per finding, with its repo, its file relative to the repo root, the line on the branch as it is now, with your fixes, and the finding as Markdown. Use a line inside a hunk of `git diff origin/main...HEAD` in that repo: a comment anywhere else is dropped. Findings with no line, such as a missing requirement, stay in the review only.
- Every **Decision needed:** finding as a question card, in the schema's shape. Oscar reads the cards instead of the review, so each one stands alone: an option's outcome is what the user sees, never how the code gets there.

Answer from what you have already read, with no tool calls. Either list may be empty.
