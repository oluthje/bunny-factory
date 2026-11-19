import { describe, expect, it } from "vitest";
import { GITHUB_MARKER } from "../../src/logic.ts";
import { parseThreadReplies, replyBody, replyRetryPrompt, threadRepliesJsonSchema } from "./replies.ts";

const handles = ["T1", "T2"] as const;
const result = (structured_output: unknown) => JSON.stringify({ type: "result", subtype: "success", structured_output });

describe("thread replies", () => {
  it("hands the CLI a schema limited to the run's handles, without $schema", () => {
    const schema = JSON.parse(threadRepliesJsonSchema(handles));
    expect(schema).not.toHaveProperty("$schema");
    expect(schema.properties.replies.items.properties.thread.enum).toEqual(["T1", "T2"]);
  });

  it("accepts one reply per thread", () => {
    const replies = [
      { thread: "T1", outcome: "done", reply: "Added the nil check in abc123." },
      { thread: "T2", outcome: "declined", reply: "The API already guarantees it." },
    ];
    expect(parseThreadReplies(result({ replies }), handles)).toEqual({ ok: true, replies });
  });

  it("rejects an unknown handle, a missing result, or two replies to one thread", () => {
    expect(parseThreadReplies(result({ replies: [{ thread: "T9", outcome: "done", reply: "x" }] }), handles)).toMatchObject({
      ok: false,
      error: /The reply pass's replies are invalid/,
    });
    expect(parseThreadReplies("", handles, "boom")).toEqual({ ok: false, error: "The reply pass wrote no result: boom" });
    const twice = [
      { thread: "T1", outcome: "done", reply: "a" },
      { thread: "T1", outcome: "answered", reply: "b" },
    ];
    expect(parseThreadReplies(result({ replies: twice }), handles)).toEqual({
      ok: false,
      error: "The reply pass answered T1 more than once.",
    });
  });

  it("posts the outcome first, with the run and the factory's marker", () => {
    const body = replyBody({ thread: "T1", outcome: "declined", reply: "Out of scope." }, "r1");
    expect(body).toMatch(/^\*\*Declined\.\*\* Out of scope\./);
    expect(body).toContain("run `r1`");
    expect(body.endsWith(GITHUB_MARKER)).toBe(true);
  });

  it("retries with the error, asking for the same structure with no tools", () => {
    const prompt = replyRetryPrompt("bad");
    expect(prompt).toContain("bad");
    expect(prompt).toContain("one reply per thread");
    expect(prompt).toContain("no tool calls");
  });
});
