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
  let response: Response;
  try {
    response = await fetch(url, options.init);
  } catch {
    throw new Error(`Could not reach the server for ${options.what}. Check your connection and try again.`);
  }
  return readJson<T>(response, options);
}
