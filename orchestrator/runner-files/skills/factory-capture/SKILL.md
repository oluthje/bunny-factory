---
name: factory-capture
description: Take screenshots and videos of Bunny with the Playwright browser in a factory run, and check each one. Use whenever a run captures the UI as evidence.
---

The Playwright browser writes screenshots and videos into the evidence directory. Name each file for what it shows; the task says how.

- **Screenshot:** wait for the page to settle (no spinner, nothing still saving), then `browser_take_screenshot` with a `filename`. Capture the whole state the point is about, such as the card and the totals, not one input.
- **Video:** go to the state just before the first step, `browser_start_video`, do the steps at a human pace, wait until the result is on screen, hold a second, then `browser_stop_video`, and rename the file it writes. Keep it under a minute: only the steps that show the point.
- **Check each capture right away:** `ls -l` it in the evidence directory, and look at a screenshot with the Read tool. An empty file, a login page or a spinner is not evidence: capture it again.

**Done when** every capture you took is a non-empty file in the evidence directory, under a name that says what it shows, and shows it.
