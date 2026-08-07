import { describe, expect, it, vi } from "vitest";
import { UpstashRedisClient } from "../src/lib/storage/upstash-redis-client.js";

describe("Upstash Redis REST client", () => {
  it("sends authenticated Redis commands without exposing the token in the URL", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchImplementation = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      capturedUrl =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      capturedInit = init;
      return Promise.resolve(new Response(JSON.stringify({ result: "value" })));
    });
    const client = new UpstashRedisClient({
      url: "https://example.upstash.io/",
      token: "private-token",
      fetchImplementation,
    });
    await expect(client.get("cache:key")).resolves.toBe("value");
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(capturedUrl).toBe("https://example.upstash.io");
    expect(capturedInit?.headers).toMatchObject({ authorization: "Bearer private-token" });
    expect(capturedInit?.body).toBe('["GET","cache:key"]');
    expect(capturedUrl).not.toContain("private-token");
  });

  it("preserves atomic command options and Lua evaluation ordering", async () => {
    const bodies: string[] = [];
    const fetchImplementation = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      if (typeof init?.body !== "string") throw new Error("Expected a string request body.");
      bodies.push(init.body);
      return Promise.resolve(new Response(JSON.stringify({ result: "OK" })));
    });
    const client = new UpstashRedisClient({
      url: "https://example.upstash.io",
      token: "token",
      fetchImplementation,
    });
    await client.set("lock:key", "owner", { px: 5_000, nx: true });
    await client.eval("return 1", ["first", "second"], [3, "four"]);
    expect(bodies).toEqual([
      '["SET","lock:key","owner","PX",5000,"NX"]',
      '["EVAL","return 1",2,"first","second",3,"four"]',
    ]);
  });

  it("normalizes provider failures without including response bodies", async () => {
    const client = new UpstashRedisClient({
      url: "https://example.upstash.io",
      token: "token",
      fetchImplementation: () =>
        Promise.resolve(new Response("sensitive redis response", { status: 500 })),
    });
    await expect(client.get("key")).rejects.toThrow("Redis request was rejected.");
    await expect(client.get("key")).rejects.not.toThrow("sensitive redis response");
  });
});
