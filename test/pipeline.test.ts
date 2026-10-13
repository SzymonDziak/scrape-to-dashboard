import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parseRobots } from "../src/robots.js";
import { parseListing, parseProduct } from "../src/parse.js";
import { normalize } from "../src/schema.js";
import { addReject, openDb, scrapedUrls, upsertBook } from "../src/db.js";
import { getText } from "../src/http.js";
import { crawl } from "../src/crawl.js";
import { renderHtml, toCsv, loadRows } from "../src/dashboard.js";

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const BASE = "https://books.toscrape.com/catalogue/";

describe("parsing", () => {
  it("parses a listing page", () => {
    const l = parseListing(fx("listing.html"), BASE + "page-2.html");
    expect(l.products).toHaveLength(20);
    expect(l.products[0]).toBe(BASE + "in-her-wake_980/index.html");
    expect(l.next).toBe(BASE + "page-3.html");
  });
  it("parses a product page", () => {
    const url = BASE + "a-light-in-the-attic_1000/index.html";
    const raw = parseProduct(fx("product.html"), url);
    expect(raw).toMatchObject({ title: "A Light in the Attic", priceText: "£51.77", ratingClass: "Three", category: "Poetry", upc: "a897fe39b1053632" });
    expect(raw.availabilityText).toContain("22 available");
  });
});

describe("normalize + validate", () => {
  const raw = () => parseProduct(fx("product.html"), BASE + "a-light-in-the-attic_1000/index.html");
  it("normalizes good rows", () => {
    const n = normalize(raw());
    expect(n.ok && n.book).toMatchObject({ price: 51.77, currency: "GBP", rating: 3, availability: 22, category: "Poetry" });
  });
  it("parses the second fixture", () => {
    const n = normalize(parseProduct(fx("product2.html"), BASE + "sharp-objects_997/index.html"));
    expect(n.ok).toBe(true);
  });
  it("rejects bad rows with reasons", () => {
    const bad = normalize({ ...raw(), priceText: "free!", ratingClass: "Zero", upc: "" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toMatch(/price.*rating.*upc|price/);
    const noCur = normalize({ ...raw(), priceText: "¥100" });
    expect(noCur.ok).toBe(false);
  });
});

describe("robots.txt", () => {
  const txt = fx("robots-sample.txt");
  it("uses the * group for unknown agents", () => {
    const r = parseRobots(txt, "other-bot/1.0");
    expect(r.isAllowed("/private/x")).toBe(false);
    expect(r.isAllowed("/private/public-report.html")).toBe(true); // longest match wins
    expect(r.isAllowed("/data/a.json")).toBe(false); // wildcard + end anchor
    expect(r.isAllowed("/data/a.json.txt")).toBe(true);
    expect(r.isAllowed("/catalogue/")).toBe(true);
    expect(r.crawlDelay).toBe(2);
  });
  it("prefers a specific agent group", () => {
    const r = parseRobots(txt, "scrape-to-dashboard-demo/1.0");
    expect(r.isAllowed("/blocked/x")).toBe(false);
    expect(r.isAllowed("/private/x")).toBe(true);
  });
  it("empty robots allows everything", () => expect(parseRobots("", "x").isAllowed("/a")).toBe(true));
});

describe("upsert + price history", () => {
  const book = () => {
    const n = normalize(parseProduct(fx("product.html"), BASE + "a-light-in-the-attic_1000/index.html"));
    if (!n.ok) throw new Error(n.reason);
    return n.book;
  };
  it("is idempotent and records price changes", () => {
    const db = openDb(":memory:");
    const b = book();
    expect(upsertBook(db, b, "2026-01-01")).toBe("inserted");
    expect(upsertBook(db, b, "2026-01-02")).toBe("unchanged");
    expect(upsertBook(db, { ...b, price: 40 }, "2026-01-03")).toBe("price_changed");
    const count = (t: string) => (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;
    expect(count("books")).toBe(1);
    expect(count("price_history")).toBe(2);
    expect((db.prepare("SELECT price FROM books").get() as { price: number }).price).toBe(40);
    expect(scrapedUrls(db).has(b.url)).toBe(true);
  });
  it("stores rejects", () => {
    const db = openDb(":memory:");
    addReject(db, "http://x/1", "bad price", { a: 1 });
    expect(db.prepare("SELECT reason FROM rejects").get()).toMatchObject({ reason: "bad price" });
  });
});

describe("http retries", () => {
  const o = (f: typeof fetch) => ({ retries: 2, timeoutMs: 1000, backoffMs: 10, fetchImpl: f, sleep: async () => {} });
  it("retries 5xx then succeeds", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(new Response("ok"));
    expect(await getText("http://x", o(f as unknown as typeof fetch))).toBe("ok");
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("does not retry 404", async () => {
    const f = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    await expect(getText("http://x", o(f as unknown as typeof fetch))).rejects.toThrow(/404/);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("crawl end-to-end (offline) + dashboard", () => {
  const pages: Record<string, string> = {
    "https://books.toscrape.com/catalogue/page-2.html": fx("listing.html"),
  };
  const fakeFetch = (async (u: string) => {
    if (u.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /nope/", { status: 200 });
    if (pages[u]) return new Response(pages[u]);
    if (u.includes("_")) return new Response(fx("product.html")); // every product page returns the same book
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;

  it("scrapes, resumes, and builds outputs", async () => {
    const db = openDb(":memory:");
    const opts = { baseUrl: "https://books.toscrape.com/", startPath: "/catalogue/page-2.html", limit: 3, concurrency: 2, delayMs: 0, refresh: false,
      http: { retries: 0, timeoutMs: 1000, backoffMs: 1, fetchImpl: fakeFetch, sleep: async () => {} } };
    const s1 = await crawl(db, opts);
    // three distinct URLs, one UPC (same fixture) -> 1 inserted, 2 unchanged
    expect(s1.inserted + s1.unchanged).toBe(3);
    expect(s1.rejected).toBe(0);
    const s2 = await crawl(db, opts); // resumable: URLs already scraped are skipped...
    expect(s2.skipped).toBeGreaterThanOrEqual(1);
    expect(s2.inserted).toBe(0);
    const rows = loadRows(db);
    expect(rows.length).toBe(1);
    const html = renderHtml(rows, "2026-01-01T00:00:00Z");
    expect(html).toContain("A Light in the Attic");
    expect(html).not.toContain("</script><script>alert");
    expect(toCsv(rows).split("\n")[0]).toBe("upc,title,price,currency,rating,availability,category,url,scraped_at");
  });
  it("escapes CSV cells", () => {
    const csv = toCsv([{ upc: "u", title: 'He said "hi", ok', price: 1, currency: "GBP", rating: 1, availability: 0, category: "c", url: "u", scraped_at: "t" }]);
    expect(csv).toContain('"He said ""hi"", ok"');
  });
});
