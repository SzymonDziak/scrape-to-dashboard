import * as cheerio from "cheerio";

export interface RawBook {
  url: string;
  title: string;
  priceText: string;
  ratingClass: string;
  availabilityText: string;
  category: string;
  upc: string;
}

/** Product URLs and next-page URL from a listing page. */
export function parseListing(html: string, pageUrl: string): { products: string[]; next?: string } {
  const $ = cheerio.load(html);
  const products = $("article.product_pod h3 a")
    .map((_, a) => new URL($(a).attr("href") ?? "", pageUrl).href)
    .get();
  const n = $("li.next a").attr("href");
  return { products, next: n ? new URL(n, pageUrl).href : undefined };
}

/** Extract raw (unvalidated) strings from a product page. Missing parts become "". */
export function parseProduct(html: string, url: string): RawBook {
  const $ = cheerio.load(html);
  const main = $("article.product_page");
  const rating = (main.find("p.star-rating").attr("class") ?? "").replace("star-rating", "").trim();
  const crumbs = $("ul.breadcrumb li").map((_, li) => $(li).text().trim()).get();
  const cell = (label: string) =>
    $("table.table-striped th").filter((_, th) => $(th).text().trim() === label).next("td").text().trim();
  return {
    url,
    title: main.find("h1").first().text().trim(),
    priceText: main.find("p.price_color").first().text().trim(),
    ratingClass: rating,
    availabilityText: main.find("p.availability").text().replace(/\s+/g, " ").trim(),
    category: crumbs.length >= 3 ? crumbs[crumbs.length - 2] : "",
    upc: cell("UPC"),
  };
}
