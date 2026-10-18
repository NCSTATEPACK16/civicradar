import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PoliteFetcher, RobotsDisallowedError } from "../src/http/politeFetch.js";

function fakeFetch(handler: (url: string, headers: Record<string, string>) => Response) {
  const calls: { url: string; at: number; headers: Record<string, string> }[] = [];
  const impl = (async (input: string | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(input), at: Date.now(), headers });
    return handler(String(input), headers);
  }) as typeof fetch;
  return { impl, calls };
}

describe("PoliteFetcher", () => {
  it("sends the User-Agent, revalidates with ETag, and serves 304s from cache", async () => {
    const { impl, calls } = fakeFetch((url, h) => {
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      if (h["if-none-match"] === '"v1"') return new Response(null, { status: 304 });
      return new Response("hello", { status: 200, headers: { etag: '"v1"', "content-type": "text/plain" } });
    });
    const f = new PoliteFetcher({ cacheDir: await mkdtemp(join(tmpdir(), "cr-")), minIntervalMs: 0, fetchImpl: impl });
    const a = await f.get("https://example.org/a");
    const b = await f.get("https://example.org/a");
    expect(a.body.toString()).toBe("hello");
    expect(a.fromCache).toBe(false);
    expect(b.body.toString()).toBe("hello");
    expect(b.fromCache).toBe(true);
    expect(calls.at(-1)!.headers["if-none-match"]).toBe('"v1"');
    expect(calls.at(-1)!.headers["user-agent"]).toMatch(/^CivicRadar\//);
  });

  it("spaces requests to one host by minIntervalMs", async () => {
    const { impl, calls } = fakeFetch((url) =>
      url.endsWith("/robots.txt") ? new Response("", { status: 404 }) : new Response("x"),
    );
    const f = new PoliteFetcher({ cacheDir: await mkdtemp(join(tmpdir(), "cr-")), minIntervalMs: 150, fetchImpl: impl });
    await Promise.all([f.get("https://h.test/1"), f.get("https://h.test/2")]);
    const times = calls.map((c) => c.at);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(140);
  });

  it("refuses URLs disallowed by robots.txt", async () => {
    const { impl } = fakeFetch((url) =>
      url.endsWith("/robots.txt") ? new Response("User-agent: *\nDisallow: /private") : new Response("x"),
    );
    const f = new PoliteFetcher({ cacheDir: await mkdtemp(join(tmpdir(), "cr-")), minIntervalMs: 0, fetchImpl: impl });
    await expect(f.get("https://h.test/private/doc")).rejects.toBeInstanceOf(RobotsDisallowedError);
  });
});
