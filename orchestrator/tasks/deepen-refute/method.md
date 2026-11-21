# How to refute a candidate

The candidate was written by an agent sent to find something to deepen, so it argues one side. You read it cold and argue the other, then judge. The **attacks** below are the method: a candidate earns `do it` by surviving them, measured against the code.

## 1. Check the claims

List every claim the candidate makes about the code: each file it names, each friction in its Problem, each module it calls shallow, each benefit that rests on how the code is today. Open each one at `origin/main` and mark it **holds**, **overstated** or **wrong**, with `repo/path/to/file.rb:42`.

Done when every file under Files and every sentence of the Problem has a mark.

## 2. Attack it

Run every attack. Each ends in a finding with its evidence, or in "doesn't land" with why.

- **Deletion test.** Delete the module the candidate calls shallow, in your head: does its complexity concentrate in one place or spread across the callers? If it spreads, the module is earning its keep.
- **Hypothetical seam.** Count the adapters behind the seam the candidate adds or keeps. One adapter is a seam nobody needs yet.
- **Churn.** `git log --oneline --since="6 months ago" -- <the files>` in each repo. A deepening pays back only through future changes: files that haven't changed have no changes to make easier.
- **Callers.** Find every call site of the interfaces that would change (`grep -rn`). Count them, and note the ones outside the repo: another repo, a public API, a background job's stored arguments.
- **Tests.** Find the specs covering these modules. Count the ones that get rewritten and the ones that get deleted, and say what stops being covered if the interface becomes the test surface.
- **Door.** Look for the one-way parts: a migration, a public API or GraphQL field, a name that ends up in stored data, a customer-facing email.
- **Cheaper alternative.** Name the smallest change that buys most of the benefit, such as moving one function or deleting one layer, and what leaving it alone costs per month in practice.
- **Hidden reason.** Read `git log -p` on the shallow module's first commits and any comment above it. Code that looks needless often answers a bug or a constraint the candidate didn't see.

Done when all eight attacks have a finding or a "doesn't land".

## 3. Make the case for

What survived? Say it as locality (what a reader no longer has to hold in their head, and where bugs stop hiding) and leverage (what callers get per line of interface). Keep only what step 1 marked **holds**.

## 4. Count the cost

Files touched, call sites changed, specs rewritten and deleted, repos involved and so how many PRs and in what order, and the door. Count with commands, and give the numbers.

## 5. Give the verdict

- `do it`: the Problem holds, the candidate survived the attacks, and the cost is in proportion to what the churn says it pays back.
- `don't`: the Problem doesn't hold, an attack is fatal, or the cheaper alternative wins. If the cheaper alternative wins, the conclusion says what it is.
- `not yet`: the candidate is right but its payback depends on something that hasn't happened. Name the condition as something a later scan can check in the code or the ticket tracker: "a second adapter exists behind the seam", "the invoicing specs no longer need the database".

Every verdict goes to Oscar, so "a human should decide" is no verdict. When the case is close, pick the side the cost favours and put the closeness in the opening sentences.
