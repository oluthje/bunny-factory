import { describe, expect, it } from "vitest";
import type { ReviewThread } from "../../src/comments.ts";
import { GITHUB_MARKER, isFactoryGithubBody, linearComment, markForGithub } from "../../src/logic.ts";
import { renderFeedback, threadsWaitingOnFactory } from "./feedback.ts";

const viewer = "oscar";
const factory = (body: string) => ({ author: viewer, body: markForGithub(body), createdAt: "2026-11-18T10:00:00Z" });
const oscar = (body: string, createdAt = "2026-11-18T11:00:00Z") => ({ author: viewer, body, createdAt });
const thread = (over: Partial<ReviewThread> = {}): ReviewThread => ({
  id: "PRRT_1",
  repo: "api",
  path: "app/models/invoice.rb",
  line: 42,
  isResolved: false,
  comments: [factory("Missing nil check."), oscar("Yes, fix this.")],
  ...over,
});

describe("isFactoryGithubBody", () => {
  it("knows the factory by its marker, or the footer of a PR body or review from before it", () => {
    expect(isFactoryGithubBody(`x\n\n${GITHUB_MARKER}`)).toBe(true);
    expect(isFactoryGithubBody("…\n---\nPosted by Oscar's factory (run `r1`).")).toBe(true);
    expect(isFactoryGithubBody("Please rename this.")).toBe(false);
  });
});

describe("threadsWaitingOnFactory", () => {
  it("keeps an unresolved thread where Oscar has the last word", () => {
    expect(threadsWaitingOnFactory([thread()], viewer)).toHaveLength(1);
  });

  it("drops resolved threads, threads the factory answered last, and threads a teammate ended", () => {
    expect(threadsWaitingOnFactory([thread({ isResolved: true })], viewer)).toEqual([]);
    expect(threadsWaitingOnFactory([thread({ comments: [factory("Missing nil check.")] })], viewer)).toEqual([]);
    expect(threadsWaitingOnFactory([thread({ comments: [oscar("Fix"), { ...oscar("hm"), author: "teammate" }] })], viewer)).toEqual([]);
  });
});

describe("renderFeedback", () => {
  const since = "2026-11-18T10:30:00Z";
  const render = (over: Partial<Parameters<typeof renderFeedback>[0]> = {}) =>
    renderFeedback({ threads: [], prComments: [], ticketComments: [], since, viewer, ...over });

  it("gives each waiting thread a handle and shows the conversation, factory and Oscar apart", () => {
    const f = render({ threads: [thread(), thread({ id: "PRRT_2", isResolved: true }), thread({ id: "PRRT_3", line: null })] });
    expect(f.handles).toEqual({ T1: "PRRT_1", T2: "PRRT_3" });
    expect(f.markdown).toContain("#### T1: `api/app/models/invoice.rb:42`");
    expect(f.markdown).toContain("**Factory:**\n\n> Missing nil check.");
    expect(f.markdown).toContain("**Oscar:**\n\n> Yes, fix this.");
    expect(f.markdown).not.toContain(GITHUB_MARKER);
    expect(f.markdown).toContain("(outdated: the line has since changed)");
    expect(f.any).toBe(true);
  });

  it("takes Oscar's PR comments since the last run, not the factory's or a teammate's", () => {
    const f = render({
      prComments: [
        { repo: "app", ...oscar("Old.", "2026-11-18T09:00:00Z") },
        { repo: "app", ...oscar("Make the button blue.") },
        { repo: "app", ...factory("Opened.") },
        { repo: "app", ...oscar("Mine."), author: "teammate" },
      ],
    });
    expect(f.markdown).toContain("### PR comments\n\napp, 2026-11-18:\n\n> Make the button blue.");
    expect(f.markdown).not.toContain("Old.");
    expect(f.markdown).not.toContain("Mine.");
  });

  it("splits Oscar's ticket comments into new and earlier context, skipping the factory's", () => {
    const f = render({
      ticketComments: [
        { body: "Use the v2 endpoint.", createdAt: "2026-11-18T09:00:00Z", isMe: true },
        { body: "Also handle refunds.", createdAt: "2026-11-18T11:00:00Z", isMe: true },
        { body: linearComment("Picked up.", "r1"), createdAt: "2026-11-18T11:30:00Z", isMe: true },
        { body: "Teammate idea.", createdAt: "2026-11-18T11:00:00Z", isMe: false },
      ],
    });
    expect(f.markdown).toContain("### Ticket comments\n\n2026-11-18:\n\n> Also handle refunds.");
    expect(f.markdown).toContain("### Earlier ticket comments\n\nContext only");
    expect(f.markdown.indexOf("Use the v2 endpoint.")).toBeGreaterThan(f.markdown.indexOf("### Earlier"));
    expect(f.markdown).not.toContain("Picked up.");
    expect(f.markdown).not.toContain("Teammate idea.");
  });

  it("says so when there's nothing new", () => {
    const f = render();
    expect(f.any).toBe(false);
    expect(f.markdown).toMatch(/^None:/);
  });

  it("treats everything as new when the ticket has no finished run", () => {
    const f = render({ since: null, ticketComments: [{ body: "Old.", createdAt: "2020-01-01T00:00:00Z", isMe: true }] });
    expect(f.markdown).toContain("### Ticket comments");
  });
});
