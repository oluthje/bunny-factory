---
name: oscar-factory-evidence
description: Capture before-and-after visual evidence for a PR. Use when a change alters what a user sees or does in the UI, before editing any code, and again when writing the PR body's Evidence section.
---

Visual evidence shows a reviewer the change without checking out the branch. It fills the **Evidence** section of the `pr` skill's template.

## 1. Classify the change

Decide which kind of change it is before touching code. The kind sets the format of both the _before_ and the _after_:

- **Simple**: the change shows in one screen state, such as a new column, a fixed label or a restyled button. Evidence is a **before and after screenshot** (PNG).
- **Multi-step**: the change shows only across an interaction, such as filling and submitting a form, a wizard, a validation error, a modal flow or a drag. Evidence is a **before and after GIF** of the same flow.

A change that is invisible in the UI (an API-only change, a refactor) needs none of this: use the `pr` skill's execution evidence, the spec that fails before and passes after.

**Done when** you have written down the kind and the exact screens or flow you will capture.

## 2. Capture the _before_, on the unchanged code

With the stack still running the base branch, capture each screen or flow from step 1 with the Playwright MCP browser:

- **Screenshot**: navigate, wait for the page to settle, then `browser_take_screenshot`.
- **GIF**: `browser_start_video`, perform the flow at a human pace, then `browser_stop_video`. Keep it short: only the steps that show the change.

Use the same viewport, user and data you will use for the _after_, so the pair differs only by the change. Save each file in the evidence directory under a name that pairs it with its _after_: `before-<slug>.png` / `after-<slug>.png`, or `before-<slug>.gif` / `after-<slug>.gif`.

When a _before_ cannot exist (a brand-new page or flow), skip it and record why in one line for the PR body.

**Done when** every screen or flow from step 1 has a _before_ file or a written reason.

## 3. Capture the _after_, once the change works

Repeat step 2 exactly (same path, viewport, user, data and slug) on the changed code.

**Done when** every _before_ has a matching _after_.

## 4. Make the GIFs

A recording comes out as a video. Turn each into a GIF at the slug's `.gif` name:

- If `ffmpeg` is on the PATH, convert it yourself: about 10 fps and 960 px wide, kept under 10 MB.
- Otherwise save the video beside it as `<before|after>-<slug>.webm` and reference the `.gif` name anyway: whoever publishes the PR converts each `.webm` to the GIF of the same name.

## 5. Write the Evidence section

Pair each _before_ with its _after_, side by side in a table, referencing files by their path relative to the evidence directory:

```markdown
## Evidence

| Before | After |
| --- | --- |
| ![Before: invoices list](evidence/before-invoices-list.png) | ![After: invoices list with refund date](evidence/after-invoices-list.png) |
```

Under the table, add one line per pair saying what to look for. Add a line for anything you could not capture and why: a route that returns 502, a PDF, a third-party API the runner cannot reach.

**Done when** every captured pair is in the table, and every gap has its reason.
