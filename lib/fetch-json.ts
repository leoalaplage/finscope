/**
 * Reading a JSON answer, including when it is not one.
 *
 * Every fetch in this application used to do `await response.json()` before
 * looking at the status, so a response that was not JSON threw the parser's own
 * error and that is what the reader was shown. In Safari that error reads "The
 * string did not match the expected pattern", which tells someone looking at a
 * heat map precisely nothing about what went wrong or what to do.
 *
 * And it is not a rare path. A Cloudflare Worker under CPU pressure answers a
 * plain-text `error code: 1102` page, a gateway sends HTML, and an interrupted
 * connection sends a fragment — none of them JSON, all of them ordinary things
 * that happen to a real site.
 *
 * The body is read once as text, parsed if it can be, and turned into a
 * sentence about this application rather than about a parser either way.
 */

/** What the server says went wrong, when it manages to say it in JSON. */
interface ErrorShape { error?: string }

/**
 * Cloudflare's own refusals, which arrive as text rather than as JSON.
 *
 * 1102 is the Worker exceeding its CPU allowance, which is what a burst of
 * cold company builds provokes; it clears on its own within minutes. Saying so
 * is far more use than either the code or a parser error.
 */
function platformMessage(status: number, body: string): string | null {
  if (/error code: 1102/i.test(body)) return "The server was too busy to answer. This clears on its own after a minute or two.";
  if (status === 429) return "Too many requests for the moment. Wait a few seconds and try again.";
  if (status === 502 || status === 503 || status === 504) return "The server did not answer in time. Try again in a moment.";
  return null;
}

export interface ReadJsonOptions {
  /** What was being fetched, in the reader's words: "today's moves". */
  what: string;
}

const TRANSIENT_GATEWAYS = new Set([502, 503, 504]);
const RETRY_DELAY_MS = 500;
const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Whether one more read can help without making an overloaded Worker worse.
 *
 * A gateway can give up while a cold company build is still completing. Its
 * immediate successor then often lands on the cache that first request just
 * filled, so making the reader press the same button again is needless. Error
 * 1102 is different: Cloudflare has suspended the Worker for excess CPU and a
 * half-second retry only adds pressure, so that response keeps its explicit
 * wait-a-minute message and is returned at once.
 */
async function retryableGateway(response: Response) {
  if (!TRANSIENT_GATEWAYS.has(response.status)) return false;
  const body = await response.clone().text().catch(() => "");
  return !/error code: 1102/i.test(body);
}

/**
 * The body and the trouble with it, separately, for callers that can use a
 * failed answer.
 *
 * The market page is the case: its endpoint answers a failed status while
 * still carrying one entry per index, each saying what went wrong with that
 * one, and drawing three named panels with three reasons beats drawing a page
 * that says only that something failed. It still must never meet a parser's
 * error, which is the whole point of going through here.
 */
export function parsedBody<T>(response: Response, body: string, what: string): { data: T | null; error: string | null } {
  let parsed: unknown;
  let parseable = true;
  try {
    parsed = body.length ? JSON.parse(body) : undefined;
  } catch {
    parseable = false;
  }
  const data = parseable && parsed !== undefined ? parsed as T : null;

  if (!response.ok) {
    const stated = parseable && parsed && typeof parsed === "object" ? (parsed as ErrorShape).error : undefined;
    return { data, error: stated || platformMessage(response.status, body) || `Could not load ${what} (${response.status}).` };
  }
  if (data === null) {
    // A 200 that is not JSON is an edge or a proxy answering in our place.
    return { data, error: platformMessage(response.status, body) || `Could not read ${what}: the server sent something other than data.` };
  }
  return { data, error: null };
}

export async function readParsed<T>(response: Response, { what }: ReadJsonOptions) {
  return parsedBody<T>(response, await response.text(), what);
}

/**
 * The parsed body, or an error worth showing a person.
 *
 * Throws on a failed status too, so callers stop repeating `if (!response.ok)`
 * after already having parsed a body that may not exist.
 */
export async function readJson<T>(response: Response, options: ReadJsonOptions): Promise<T> {
  const { data, error } = await readParsed<T>(response, options);
  if (error !== null) throw new Error(error);
  return data as T;
}

/**
 * Fetch and read in one call, for the common case.
 *
 * A network failure gets the same treatment as a bad body: a sentence about
 * this application. `fetch` rejects with "Load failed" or "NetworkError when
 * attempting to fetch resource" depending on the browser, and neither belongs
 * on screen.
 */
export async function getJson<T>(url: string, options: ReadJsonOptions & { init?: RequestInit }): Promise<T> {
  // Every current caller is a read, but keep the guarantee local: if a future
  // caller supplies a mutating method, never duplicate it automatically.
  const canRetry = (options.init?.method ?? "GET").toUpperCase() === "GET";
  const attempts = canRetry ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, options.init);
    } catch {
      if (attempt + 1 < attempts) { await pause(RETRY_DELAY_MS); continue; }
      throw new Error(`Could not reach the server for ${options.what}. Check your connection and try again.`);
    }
    if (attempt + 1 < attempts && await retryableGateway(response)) {
      await pause(RETRY_DELAY_MS);
      continue;
    }
    return readJson<T>(response, options);
  }
  // The loop always returns or throws; this keeps the function total if its
  // retry policy is edited later.
  throw new Error(`Could not reach the server for ${options.what}. Check your connection and try again.`);
}
