The findings are written. Now hand them back as structured output, the same flows in the same order, so the factory can post them:

- `flows`: every row of the coverage table, each with its interface, `UI` or `API`, as you planned it. A flow that hit a defect names it by its position in `defects`, from 1. A flow that passed while walking a known defect's steps carries that defect's reference in `knownAs`, with `fixed` or `not-reproduced` and the one-sentence reason.
- `defects`: every defect you reproduced, each once. One that matched a known defect carries its reference in `knownAs`.
- `suspects`: the ones you tried and couldn't reproduce, each with what you captured of it.
- Evidence: the file names as saved in the evidence directory, exactly.

Answer from what you have already read and written, with no tool calls.
