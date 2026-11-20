# What an easy call is

A PR is an easy call when Oscar, reading it, would merge it without a second thought, and you'd stake the merge on that. Each line below is a signal, not a hard limit, except under **Never**.

## Merge when all of these hold

- **The ticket is clear.** A bug with repro steps, or a change with a "Done when" list. Not a question.
- **The diff does what the ticket asks, and no more.** No unrelated cleanup, renames or drive-by fixes.
- **It's small.** About 100 changed lines or fewer, in 3 files or fewer, or config and form JSON only. Bigger is fine only when the bulk is a test.
- **It's tested.** It adds or changes a test that fails without the fix: a spec, a unit test or a story test.
- **It's local.** One component, model or service, and its callers are unaffected.

## Never

Any one of these makes the PR `human-needed`, however small:

- **The ticket asks a question or wants a design choice**: "Should…?", "suggest three mockups", "explore". A tiny diff that answers a product question still needs Oscar.
- **An unanswered Decision needed.** The review left a **Decision needed:** finding, and nobody has answered it on the PR or the ticket.
- **A one-way door**: a migration that drops or rewrites data, a public API or GraphQL schema change, a customer-facing email, or a name that ends up in stored data.
- **Shared framework code**: hooks, form engines, parsers or base classes that many screens use (`useGQLMutation`, `NewFormPage`, `FormTreeParser` and the like).
- **Pricing, billing, invoicing or money rules**: how an amount, charge, price or credit is computed or validated.
- **Auth, permissions or data access**: who can see or change what.
- **A visible change the ticket didn't ask for**, such as values rendered differently elsewhere.

## The review's findings

The factory review is evidence. Its CHANGES REQUESTED doesn't hold a PR back when every finding left is minor (a naming nit, a missing comment, a test that could be tighter) and you say so. A finding that the spec isn't met, or that something breaks, does.

## When unsure

`human-needed`. A wrong `merge` lands on staging with nobody having read it; a wrong `human-needed` costs Oscar a minute.
