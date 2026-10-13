import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Book } from "./schema.js";

export function openDb(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS books (
      upc TEXT PRIMARY KEY, title TEXT NOT NULL, price REAL NOT NULL, currency TEXT NOT NULL,
      rating INTEGER NOT NULL, availability INTEGER NOT NULL, category TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE, scraped_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, upc TEXT NOT NULL REFERENCES books(upc),
      price REAL NOT NULL, observed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rejects (
      id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, reason TEXT NOT NULL,
      raw TEXT, scraped_at TEXT NOT NULL
    );
  `);
  return db;
}

export type UpsertResult = "inserted" | "price_changed" | "unchanged";

/** Upsert by UPC. A price_history row is written on first sight and whenever the price changes. */
export function upsertBook(db: DatabaseSync, b: Book, now = new Date().toISOString()): UpsertResult {
  const prev = db.prepare("SELECT price FROM books WHERE upc = ?").get(b.upc) as { price: number } | undefined;
  db.prepare(
    `INSERT INTO books (upc,title,price,currency,rating,availability,category,url,scraped_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(upc) DO UPDATE SET title=excluded.title, price=excluded.price, currency=excluded.currency,
       rating=excluded.rating, availability=excluded.availability, category=excluded.category,
       url=excluded.url, scraped_at=excluded.scraped_at`,
  ).run(b.upc, b.title, b.price, b.currency, b.rating, b.availability, b.category, b.url, now);
  if (prev && prev.price === b.price) return "unchanged";
  db.prepare("INSERT INTO price_history (upc, price, observed_at) VALUES (?,?,?)").run(b.upc, b.price, now);
  return prev ? "price_changed" : "inserted";
}

export function addReject(db: DatabaseSync, url: string, reason: string, raw?: unknown, now = new Date().toISOString()) {
  db.prepare("INSERT INTO rejects (url, reason, raw, scraped_at) VALUES (?,?,?,?)")
    .run(url, reason, raw === undefined ? null : JSON.stringify(raw), now);
}

export function scrapedUrls(db: DatabaseSync): Set<string> {
  return new Set((db.prepare("SELECT url FROM books").all() as { url: string }[]).map((r) => r.url));
}
