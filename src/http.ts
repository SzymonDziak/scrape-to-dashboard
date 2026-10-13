export const USER_AGENT = "scrape-to-dashboard-demo/1.0 (portfolio demo by Simon Dziak, App369; polite crawler)";

export interface FetchOptions {
  retries: number;
  timeoutMs: number;
  backoffMs: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(public status: number, url: string) { super(`HTTP ${status} for ${url}`); }
}

/** GET with exponential backoff on 5xx, 429, network errors and timeouts. 4xx (other) fails fast. */
export async function getText(url: string, o: FetchOptions): Promise<string> {
  const f = o.fetchImpl ?? fetch;
  const wait = o.sleep ?? sleep;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= o.retries; attempt++) {
    try {
      const res = await f(url, {
        headers: { "user-agent": USER_AGENT, accept: "text/html,text/plain" },
        signal: AbortSignal.timeout(o.timeoutMs),
      });
      if (res.ok) return await res.text();
      if (res.status < 500 && res.status !== 429) throw new HttpError(res.status, url);
      lastErr = new HttpError(res.status, url);
    } catch (e) {
      if (e instanceof HttpError && e.status < 500 && e.status !== 429) throw e;
      lastErr = e;
    }
    if (attempt < o.retries) await wait(o.backoffMs * 2 ** attempt);
  }
  throw lastErr;
}
