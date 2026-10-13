import { parseArgs } from "node:util";
import { crawl } from "./crawl.js";
import { openDb } from "./db.js";

const { values: v } = parseArgs({
  options: {
    limit: { type: "string", default: "100" },
    concurrency: { type: "string", default: "2" },
    delay: { type: "string", default: "500" },
    retries: { type: "string", default: "3" },
    db: { type: "string", default: "data/books.db" },
    refresh: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (v.help) {
  console.log("npm run scrape -- [--limit 100] [--concurrency 2] [--delay 500 (ms)] [--retries 3] [--db data/books.db] [--refresh]");
  process.exit(0);
}

const db = openDb(v.db!);
const stats = await crawl(db, {
  baseUrl: "https://books.toscrape.com/",
  startPath: "/catalogue/page-1.html",
  limit: Number(v.limit),
  concurrency: Number(v.concurrency),
  delayMs: Number(v.delay),
  refresh: v.refresh!,
  http: { retries: Number(v.retries), timeoutMs: 15000, backoffMs: 1000 },
  log: (m) => console.log(m),
});
const total = (db.prepare("SELECT COUNT(*) n FROM books").get() as { n: number }).n;
console.log(JSON.stringify({ ...stats, booksInDb: total }));
