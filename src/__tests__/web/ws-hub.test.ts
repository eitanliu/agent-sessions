import { describe, it, expect, vi, beforeEach } from "vitest";
import { WsHub } from "../../web/ws-hub.js";

function makeMockWs(readyState = 1) {
  return { readyState, send: vi.fn(), on: vi.fn() };
}

describe("WsHub", () => {
  let hub: WsHub;

  beforeEach(() => {
    hub = new WsHub();
  });

  it("addClient / broadcast sends to open clients", () => {
    const ws1 = makeMockWs(1);
    const ws2 = makeMockWs(1);
    hub.addClient(ws1 as any);
    hub.addClient(ws2 as any);
    hub.broadcast({ type: "ping" });
    expect(ws1.send).toHaveBeenCalledWith(JSON.stringify({ type: "ping" }));
    expect(ws2.send).toHaveBeenCalledWith(JSON.stringify({ type: "ping" }));
  });

  it("removeClient stops receiving broadcasts", () => {
    const ws = makeMockWs(1);
    hub.addClient(ws as any);
    hub.removeClient(ws as any);
    hub.broadcast({ type: "ping" });
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("broadcast skips closed clients", () => {
    const closed = makeMockWs(3);
    hub.addClient(closed as any);
    hub.broadcast({ type: "ping" });
    expect(closed.send).not.toHaveBeenCalled();
  });

  it("clientCount returns correct count", () => {
    const ws1 = makeMockWs();
    const ws2 = makeMockWs();
    expect(hub.clientCount).toBe(0);
    hub.addClient(ws1 as any);
    hub.addClient(ws2 as any);
    expect(hub.clientCount).toBe(2);
    hub.removeClient(ws1 as any);
    expect(hub.clientCount).toBe(1);
  });
});
