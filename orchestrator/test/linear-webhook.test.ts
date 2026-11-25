// The /webhooks/linear endpoint (src/linear-webhook.ts): a change Linear signed becomes one
// LINEAR_CHANGED event, and anything else sends none.
import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "test-webhook-secret";
process.env.LINEAR_WEBHOOK_SECRET = SECRET;

const send = vi.fn(async () => ({ ids: [] }));
vi.mock("../src/inngest.ts", () => ({ inngest: { send }, LINEAR_CHANGED: "factory/linear.changed", SUB_TICKET_CHANGED: "factory/sub-ticket.changed" }));
const ticketParent = vi.fn(async (_id: string): Promise<{ id: string; identifier: string; labels: string[] } | null> => null);
vi.mock("../src/linear.ts", async (actual) => ({ ...(await actual<object>()), ticketParent }));

const { changedSubTicket, linearWebhookHandler, watchersOf } = await import("../src/linear-webhook.ts");
const handler = linearWebhookHandler() as unknown as (req: Request) => Promise<Response>;

function delivery(payload: object, { secret = SECRET, at = Date.now() } = {}): Request {
  const body = JSON.stringify({ ...payload, webhookTimestamp: at });
  const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return new Request("http://localhost/webhooks/linear", { method: "POST", headers: { "linear-signature": signature }, body });
}

const issueUpdate = { type: "Issue", action: "update", data: { id: "t1" } };

describe("linearWebhookHandler", () => {
  beforeEach(() => {
    send.mockClear();
    ticketParent.mockClear();
  });

  it("sends LINEAR_CHANGED for a signed change to a ticket or comment", async () => {
    expect((await handler(delivery(issueUpdate))).status).toBe(200);
    expect((await handler(delivery({ type: "Comment", action: "create", data: {} }))).status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith({ name: "factory/linear.changed", data: { source: "webhook", type: "Issue", action: "update" } });
  });

  it("tells a watching task when a sub-ticket of a ticket with its flag changes", async () => {
    ticketParent.mockResolvedValueOnce({ id: "p1", identifier: "REC-200", labels: ["oscar-factory:qa-release"] });
    await handler(delivery({ type: "Comment", action: "create", data: { issueId: "t1" } }));
    expect(ticketParent).toHaveBeenCalledWith("t1");
    expect(send).toHaveBeenCalledWith({ name: "factory/sub-ticket.changed", data: { task: "qa-plan", parent: { id: "p1", identifier: "REC-200" } } });
  });

  it("sends nothing more for a ticket whose parent no task watches, and asks Linear nothing for a top-level ticket", async () => {
    ticketParent.mockResolvedValueOnce({ id: "p1", identifier: "REC-200", labels: ["Bug"] });
    await handler(delivery({ type: "Issue", action: "update", data: { id: "t1", parentId: "p1" } }));
    await handler(delivery(issueUpdate));
    expect(ticketParent).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("ignores other kinds of change", async () => {
    expect((await handler(delivery({ type: "Project", action: "update", data: {} }))).status).toBe(200);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a delivery signed with another secret, or more than a minute old", async () => {
    expect((await handler(delivery(issueUpdate, { secret: "wrong" }))).status).toBe(400);
    expect((await handler(delivery(issueUpdate, { at: Date.now() - 120_000 }))).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("answers 500 when Inngest won't take the event, so Linear retries", async () => {
    send.mockRejectedValueOnce(new Error("down"));
    expect((await handler(delivery(issueUpdate))).status).toBe(500);
  });
});

describe("changedSubTicket", () => {
  it("is an issue with a parent, or the ticket a comment is on", () => {
    expect(changedSubTicket({ type: "Issue", data: { id: "t1", parentId: "p1" } })).toBe("t1");
    expect(changedSubTicket({ type: "Issue", data: { id: "t1", parentId: null } })).toBeNull();
    expect(changedSubTicket({ type: "Comment", data: { issueId: "t2" } })).toBe("t2");
    expect(changedSubTicket({ type: "Project", data: { id: "x" } })).toBeNull();
  });
});

describe("watchersOf", () => {
  it("finds the tasks whose flag the parent has", () => {
    expect(watchersOf(["oscar-factory:qa-release", "Bug"])).toEqual(["qa-plan"]);
    expect(watchersOf(["oscar-factory:bulk"])).toEqual([]);
  });
});
