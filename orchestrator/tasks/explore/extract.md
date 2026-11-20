The findings are written. Now hand them back as structured output:

- The verdict, from the `## Verdict:` heading: `easy-call` or `human-needed`. If the heading is missing or you're unsure, the verdict is `human-needed`.
- Each open question as a question card, in the schema's shape. Oscar reads the cards instead of the findings, so each one stands alone: an option's outcome is what the user sees, never how the code gets there. Return none on an easy call.

Answer from what you have already read, with no tool calls.
