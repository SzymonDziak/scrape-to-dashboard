import type { DatabaseSync } from "node:sqlite";
import { getText, sleep, USER_AGENT, type FetchOptions } from "./http.js";
import { parseRobots, type Robots } from "./robots.js";
import { parseListing, parseProduct } from "./parse.js";
import { normalize } from "./schema.js";
import { addReject, scrapedUrls, upsertBook } from "./db.js";

export interface CrawlOptions {
  baseUrl: string;
  startPath: string;
  limit: number;
  concurrency: number;
  delayMs: number;
  refresh: boolean; // re-fetch URLs already in the DB (records price changes)
  http: FetchOptions;
  log?: (msg: string) => void;
}

export interface CrawlStats { fetched: number; inserted: number; priceChanged: number; unchanged: number; skipped: number; rejected: number; blocked: number }

export async function loadRobots(baseUrl: string, http: FetchOptions): Promise<Robots> {
  try {
    return parseRobots(await getText(new URL("/robots.txt", baseUrl).href, { ...http, retries: 1 }), USER_AGENT);
  } catch {
    return parseRobots("", USER_AGENT); // no robots.txt (404) = nothing disallowed
  }
}

export async function crawl(db: DatabaseSync, o: CrawlOptions): Promise<CrawlStats> {
  const log = o.log ?? (() => {});
  const stats: CrawlStats = { fetched: 0, inserted: 0, priceChanged: 0, unchanged: 0, skipped: 0, rejected: 0, blocked: 0 };
  const robots = await loadRobots(o.baseUrl, o.http);
  const delay = Math.max(o.delayMs, (robots.crawlDelay ?? 0) * 1000);
  const wait = o.http.sleep ?? sleep;
  const allowed = (u: string) => (robots.isAllowed(new URL(u).pathname) ? true : (stats.blocked++, false));
  const done = o.refresh ? new Set<string>() : scrapedUrls(db);

  // Phase 1: walk listing pages (sequentially) until we have `limit` product URLs.
  const queue: string[] = [];
  let page: string | undefined = new URL(o.startPath, o.baseUrl).href;
  while (page && queue.length < o.limit) {
    if (!allowed(page)) break;
    const { products, next } = parseListing(await getText(page, o.http), page);
    stats.fetched++;
    for (const p of products) {
      if (queue.length >= o.limit) break;
      if (done.has(p)) stats.skipped++;
      else queue.push(p);
    }
    log(`listing ${page}: ${products.length} products, queue=${queue.length}`);
    page = next;
    await wait(delay);
  }

  // Phase 2: fetch product pages with a small worker pool; each worker pauses `delay` between requests.
  let idx = 0;
  const worker = async () => {
    while (idx < queue.length) {
      const url = queue[idx++];
      if (!allowed(url)) continue;
      try {
        const raw = parseProduct(await getText(url, o.http), url);
        stats.fetched++;
        const n = normalize(raw);
        if (!n.ok) { addReject(db, url, n.reason, raw); stats.rejected++; log(`reject ${url}: ${n.reason}`); }
        else {
          const r = upsertBook(db, n.book);
          if (r === "inserted") stats.inserted++; else if (r === "price_changed") stats.priceChanged++; else stats.unchanged++;
        }
      } catch (e) {
        addReject(db, url, `fetch failed: ${(e as Error).message}`);
        stats.rejected++;
      }
      await wait(delay);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency) }, worker));
  return stats;
}
