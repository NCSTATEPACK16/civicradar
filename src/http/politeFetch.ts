import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isAllowed, parseRobots, type RobotsRules } from "./robots.js";

export const USER_AGENT =
  process.env.CIVICRADAR_USER_AGENT ??
  "CivicRadar/0.1 (+https://github.com/NCSTATEPACK16/civicradar; civic data research)";

export interface FetchResult {
  url: string;
  status: number;
  contentType: string | null;
  body: Buffer;
  fromCache: boolean;
}

interface CacheMeta {
  url: string;
  status: number;
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
  fetchedAt: string;
}

export interface PoliteFetcherOptions {
  cacheDir?: string;
  minIntervalMs?: number;
  userAgent?: string;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  /** Treat cache entries younger than this as fresh without revalidating. */
  maxAgeMs?: number;
}

export class RobotsDisallowedError extends Error {}

/**
 * Fetch wrapper that honors robots.txt, identifies itself, spaces requests to the
 * same host by at least minIntervalMs, and caches bodies by URL with conditional
 * revalidation (ETag / Last-Modified) so unchanged files are never re-downloaded.
 */
export class PoliteFetcher {
  private readonly cacheDir: string;
  private readonly minIntervalMs: number;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAgeMs: number;
  private readonly nextSlot = new Map<string, number>();
  private readonly robots = new Map<string, Promise<RobotsRules>>();

  constructor(opts: PoliteFetcherOptions = {}) {
    this.cacheDir = opts.cacheDir ?? "data/cache";
    this.minIntervalMs = opts.minIntervalMs ?? 1000;
    this.userAgent = opts.userAgent ?? USER_AGENT;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxAgeMs = opts.maxAgeMs ?? 0;
  }

  async get(url: string, init: { accept?: string } = {}): Promise<FetchResult> {
    const u = new URL(url);
    const rules = await this.robotsFor(u);
    if (!isAllowed(rules, u.pathname + u.search)) {
      throw new RobotsDisallowedError(`robots.txt disallows ${url}`);
    }

    const key = createHash("sha256").update(url).digest("hex");
    const metaPath = join(this.cacheDir, `${key}.json`);
    const bodyPath = join(this.cacheDir, `${key}.bin`);
    const cached = await readCache(metaPath, bodyPath);

    if (cached && this.maxAgeMs > 0 && Date.now() - Date.parse(cached.meta.fetchedAt) < this.maxAgeMs) {
      return { ...resultFrom(cached.meta, cached.body), fromCache: true };
    }

    const headers: Record<string, string> = { "user-agent": this.userAgent };
    if (init.accept) headers.accept = init.accept;
    if (cached?.meta.etag) headers["if-none-match"] = cached.meta.etag;
    if (cached?.meta.lastModified) headers["if-modified-since"] = cached.meta.lastModified;

    await this.waitForSlot(u.host);
    const res = await this.fetchImpl(url, { headers, redirect: "follow" });

    if (res.status === 304 && cached) {
      return { ...resultFrom(cached.meta, cached.body), fromCache: true };
    }
    const body = Buffer.from(await res.arrayBuffer());
    if (!res.ok) {
      throw new Error(`GET ${url} -> HTTP ${res.status}`);
    }
    const meta: CacheMeta = {
      url,
      status: res.status,
      contentType: res.headers.get("content-type"),
      etag: res.headers.get("etag"),
      lastModified: res.headers.get("last-modified"),
      fetchedAt: new Date().toISOString(),
    };
    await mkdir(this.cacheDir, { recursive: true });
    await writeFile(bodyPath, body);
    await writeFile(metaPath, JSON.stringify(meta, null, 2));
    return { ...resultFrom(meta, body), fromCache: false };
  }

  async getText(url: string, accept?: string): Promise<string> {
    return (await this.get(url, { accept })).body.toString("utf8");
  }

  async getJson<T>(url: string): Promise<T> {
    return JSON.parse(await this.getText(url, "application/json")) as T;
  }

  private async waitForSlot(host: string): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot.get(host) ?? 0);
    this.nextSlot.set(host, slot + this.minIntervalMs);
    if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
  }

  private robotsFor(u: URL): Promise<RobotsRules> {
    let p = this.robots.get(u.origin);
    if (!p) {
      p = this.loadRobots(u);
      this.robots.set(u.origin, p);
    }
    return p;
  }

  private async loadRobots(u: URL): Promise<RobotsRules> {
    try {
      await this.waitForSlot(u.host);
      const res = await this.fetchImpl(`${u.origin}/robots.txt`, {
        headers: { "user-agent": this.userAgent },
      });
      const type = res.headers.get("content-type") ?? "";
      // A missing robots.txt (or an HTML error page served in its place) means no restrictions.
      if (!res.ok || type.includes("html")) return parseRobots("", this.userAgent);
      return parseRobots(await res.text(), this.userAgent);
    } catch {
      return parseRobots("", this.userAgent);
    }
  }
}

function resultFrom(meta: CacheMeta, body: Buffer): Omit<FetchResult, "fromCache"> {
  return { url: meta.url, status: meta.status, contentType: meta.contentType, body };
}

async function readCache(metaPath: string, bodyPath: string) {
  try {
    const meta = JSON.parse(await readFile(metaPath, "utf8")) as CacheMeta;
    const body = await readFile(bodyPath);
    return { meta, body };
  } catch {
    return null;
  }
}
