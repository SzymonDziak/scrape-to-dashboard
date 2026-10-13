import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDb } from "./db.js";

export interface Row {
  upc: string; title: string; price: number; currency: string; rating: number;
  availability: number; category: string; url: string; scraped_at: string;
}

export const COLUMNS: (keyof Row)[] = ["upc", "title", "price", "currency", "rating", "availability", "category", "url", "scraped_at"];

export function loadRows(db: DatabaseSync): Row[] {
  return db.prepare(`SELECT ${COLUMNS.join(",")} FROM books ORDER BY title`).all() as unknown as Row[];
}

const csvCell = (v: unknown) => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows: Row[]) =>
  [COLUMNS.join(","), ...rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";

export function renderHtml(rows: Row[], generatedAt = new Date().toISOString()): string {
  // Escape "<" so the inline JSON can never close the <script> tag.
  const json = JSON.stringify({ rows, generatedAt }).replace(/</g, "\\u003c");
  return TEMPLATE.replace("/*DATA*/", () => json);
}

const TEMPLATE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Books dashboard - scrape-to-dashboard demo</title>
<style>
:root{--bg:#fafaf9;--card:#fff;--fg:#1c1917;--mut:#78716c;--line:#e7e5e4;--acc:#2563eb}
@media(prefers-color-scheme:dark){:root{--bg:#0c0a09;--card:#1c1917;--fg:#f5f5f4;--mut:#a8a29e;--line:#292524;--acc:#60a5fa}}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
main{max-width:1100px;margin:0 auto;padding:24px 16px}h1{margin:0 0 4px;font-size:22px}h2{margin:0 0 8px;font-size:14px;color:var(--mut);font-weight:600}
.sub{color:var(--mut);margin-bottom:20px}.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));margin-bottom:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px}
.tiles{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:16px}
.tile b{display:block;font-size:26px;font-variant-numeric:tabular-nums}.tile span{color:var(--mut);font-size:12px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}
th{cursor:pointer;user-select:none;color:var(--mut);font-size:12px;white-space:nowrap}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
.bar{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap}input,select{background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:6px 8px;font:inherit}
input{flex:1;min-width:180px}a{color:var(--acc)}.wrap{max-height:520px;overflow:auto}canvas{max-height:300px}
</style></head><body><main>
<h1>Books dashboard</h1>
<div class="sub" id="sub"></div>
<div class="tiles" id="tiles"></div>
<div class="grid"><div class="card"><h2>Books per category (top 10)</h2><canvas id="c1"></canvas></div>
<div class="card"><h2>Rating distribution</h2><canvas id="c2"></canvas></div></div>
<div class="grid"><div class="card"><h2>Price histogram</h2><canvas id="c3"></canvas></div>
<div class="card"><h2>Top 10 most expensive</h2><table id="top"></table></div></div>
<div class="card"><h2>All books</h2>
<div class="bar"><input id="q" placeholder="Filter by title or UPC..."><select id="cat"><option value="">All categories</option></select>
<select id="rt"><option value="">Any rating</option><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select></div>
<div class="wrap"><table id="tbl"></table></div></div>
<p class="sub">Demo by Simon Dziak (App369). Data scraped from books.toscrape.com, a public scraping sandbox.</p>
</main>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script>
const D=/*DATA*/;const R=D.rows;
const $=id=>document.getElementById(id),esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const cur=R[0]?.currency==="GBP"?"£":"";const money=n=>cur+n.toFixed(2);
const avg=R.length?R.reduce((a,r)=>a+r.price,0)/R.length:0;
const cats=Object.entries(R.reduce((m,r)=>(m[r.category]=(m[r.category]||0)+1,m),{})).sort((a,b)=>b[1]-a[1]);
$("sub").textContent="Generated "+D.generatedAt.slice(0,16).replace("T"," ")+" UTC from "+R.length+" scraped books";
$("tiles").innerHTML=[["Books",R.length],["Categories",cats.length],["Avg price",money(avg)],["Avg rating",(R.reduce((a,r)=>a+r.rating,0)/(R.length||1)).toFixed(2)],["In stock units",R.reduce((a,r)=>a+r.availability,0)]]
 .map(([k,v])=>'<div class="card tile"><b>'+v+'</b><span>'+k+'</span></div>').join("");
const css=getComputedStyle(document.documentElement),acc=css.getPropertyValue("--acc").trim(),mut=css.getPropertyValue("--mut").trim(),line=css.getPropertyValue("--line").trim();
if(window.Chart){Chart.defaults.color=mut;const mk=(id,labels,data,horiz)=>new Chart($(id),{type:"bar",data:{labels,datasets:[{data,backgroundColor:acc,borderRadius:3}]},
 options:{indexAxis:horiz?"y":"x",plugins:{legend:{display:false}},scales:{x:{grid:{color:line}},y:{grid:{color:line},beginAtZero:true,ticks:{autoSkip:false}}}}});
 mk("c1",cats.slice(0,10).map(c=>c[0]),cats.slice(0,10).map(c=>c[1]),true);
 mk("c2",["1","2","3","4","5"].map(s=>s+" star"),[1,2,3,4,5].map(s=>R.filter(r=>r.rating===s).length));
 const w=10,mx=Math.max(0,...R.map(r=>r.price)),nb=Math.floor(mx/w)+1,h=Array(nb).fill(0);R.forEach(r=>h[Math.floor(r.price/w)]++);
 mk("c3",h.map((_,i)=>cur+i*w+"-"+(i+1)*w),h);}
else document.querySelectorAll("canvas").forEach(c=>c.replaceWith(Object.assign(document.createElement("p"),{textContent:"Charts need Chart.js from the CDN (offline?)."})));
const link=r=>'<a href="'+esc(r.url)+'" target="_blank" rel="noopener">'+esc(r.title)+'</a>';
$("top").innerHTML=[...R].sort((a,b)=>b.price-a.price).slice(0,10).map(r=>'<tr><td>'+link(r)+'</td><td class="n">'+money(r.price)+'</td></tr>').join("");
cats.forEach(([c])=>$("cat").add(new Option(c,c)));
const cols=[["title","Title"],["category","Category"],["price","Price","n"],["rating","Rating","n"],["availability","In stock","n"],["upc","UPC"]];
let key="title",dir=1;
function draw(){const q=$("q").value.toLowerCase(),c=$("cat").value,t=$("rt").value;
 const rows=R.filter(r=>(!q||r.title.toLowerCase().includes(q)||r.upc.toLowerCase().includes(q))&&(!c||r.category===c)&&(!t||r.rating==t))
  .sort((a,b)=>(a[key]>b[key]?1:a[key]<b[key]?-1:0)*dir);
 $("tbl").innerHTML="<thead><tr>"+cols.map(([k,l,n])=>'<th data-k="'+k+'" class="'+(n||"")+'">'+l+(k===key?(dir>0?" ▲":" ▼"):"")+"</th>").join("")+"</tr></thead><tbody>"+
  rows.map(r=>"<tr><td>"+link(r)+"</td><td>"+esc(r.category)+'</td><td class="n">'+money(r.price)+'</td><td class="n">'+r.rating+'</td><td class="n">'+r.availability+"</td><td>"+esc(r.upc)+"</td></tr>").join("")+"</tbody>";
 $("tbl").querySelectorAll("th").forEach(th=>th.onclick=()=>{const k=th.dataset.k;dir=k===key?-dir:1;key=k;draw()});}
["q","cat","rt"].forEach(i=>$(i).addEventListener("input",draw));draw();
</script></body></html>
`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: v } = parseArgs({ options: { db: { type: "string", default: "data/books.db" }, out: { type: "string", default: "dist" } } });
  const rows = loadRows(openDb(v.db!));
  mkdirSync(v.out!, { recursive: true });
  writeFileSync(join(v.out!, "index.html"), renderHtml(rows));
  writeFileSync(join(v.out!, "books.csv"), toCsv(rows));
  console.log(`Wrote ${v.out}/index.html and books.csv (${rows.length} books)`);
}
