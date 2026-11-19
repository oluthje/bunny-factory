The review is written. Now hand back every finding in it that points at a file and line, as structured output: one entry per finding, with its repo, its file relative to the repo root, the line on the reviewed branch, and the finding as Markdown.

Use a line inside a hunk of `git diff origin/main...HEAD` in that repo: a comment anywhere else is dropped. Findings with no line, such as a missing requirement, stay in the review only.

Answer from what you have already read, with no tool calls. If no finding points at a line, return an empty list.
