/** Tiny robots.txt parser: User-agent groups, Allow/Disallow with * and $, longest match wins. */
interface Rule { allow: boolean; pattern: string }
export interface Robots { isAllowed(path: string): boolean; crawlDelay?: number }

export function parseRobots(text: string, agent: string): Robots {
  const groups: { agents: string[]; rules: Rule[]; delay?: number }[] = [];
  let cur: (typeof groups)[number] | undefined;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const val = line.slice(i + 1).trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "allow" || key === "disallow") {
      if (val) cur.rules.push({ allow: key === "allow", pattern: val });
    } else if (key === "crawl-delay") {
      const n = Number(val);
      if (Number.isFinite(n)) cur.delay = n;
    }
  }
  const a = agent.toLowerCase();
  // Most specific agent token match wins; fall back to "*".
  const named = groups.filter((g) => g.agents.some((t) => t !== "*" && a.includes(t)));
  const chosen = named.length ? named : groups.filter((g) => g.agents.includes("*"));
  const rules = chosen.flatMap((g) => g.rules);
  const crawlDelay = chosen.find((g) => g.delay !== undefined)?.delay;

  const toRegex = (p: string) =>
    new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
  return {
    crawlDelay,
    isAllowed(path) {
      let best: Rule | undefined;
      for (const r of rules) {
        if (!toRegex(r.pattern).test(path)) continue;
        if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
      }
      return best ? best.allow : true;
    },
  };
}
