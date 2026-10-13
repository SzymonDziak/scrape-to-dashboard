import { z } from "zod";
import type { RawBook } from "./parse.js";

export const BookSchema = z.object({
  upc: z.string().regex(/^[a-z0-9]{8,32}$/i, "invalid UPC"),
  title: z.string().min(1, "empty title"),
  price: z.number().positive("price must be > 0").max(10000),
  currency: z.string().length(3),
  rating: z.number().int().min(1).max(5),
  availability: z.number().int().min(0),
  category: z.string().min(1, "missing category"),
  url: z.string().url(),
});
export type Book = z.infer<typeof BookSchema>;

const CURRENCIES: Record<string, string> = { "£": "GBP", "$": "USD", "€": "EUR" };
const RATINGS: Record<string, number> = { One: 1, Two: 2, Three: 3, Four: 4, Five: 5 };

export type Normalized = { ok: true; book: Book } | { ok: false; reason: string };

/** Normalise raw strings into typed fields, then validate with zod. Never throws. */
export function normalize(raw: RawBook): Normalized {
  const m = raw.priceText.match(/^([^\d\s]+)\s*([\d,]+(?:\.\d+)?)$/);
  const avail = raw.availabilityText.match(/\((\d+)\s+available\)/i);
  const candidate = {
    upc: raw.upc,
    title: raw.title,
    price: m ? Number(m[2].replace(/,/g, "")) : NaN,
    currency: m ? (CURRENCIES[m[1]] ?? "") : "",
    rating: RATINGS[raw.ratingClass] ?? NaN,
    availability: avail ? Number(avail[1]) : /^in stock/i.test(raw.availabilityText) ? 1 : 0,
    category: raw.category,
    url: raw.url,
  };
  const r = BookSchema.safeParse(candidate);
  if (r.success) return { ok: true, book: r.data };
  const reason = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  return { ok: false, reason };
}
