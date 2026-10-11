/**
 * A request to the SEC that survives the SEC saying "not now".
 *
 * EDGAR answers 403 or 429 when it judges a client too quick, and from a
 * Cloudflare Worker that judgement is shared with everyone else leaving the
 * same addresses, so a perfectly polite request is refused now and then and
 * answered a second later. Two more tries, half a second and a second and a
 * half apart, turn those refusals into a short wait instead of an empty panel.
 * Anything else — a 404, a success — is returned at once.
 */

const RETRY_AFTER_MS = [500, 1500];
const RETRYABLE = new Set([403, 429, 500, 502, 503, 504]);

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function secFetch(url: string, init: RequestInit = {}, waits: number[] = RETRY_AFTER_MS): Promise<Response> {
  let response = await fetch(url, init);
  for (const wait of waits) {
    if (!RETRYABLE.has(response.status)) return response;
    await response.body?.cancel();
    await pause(wait + Math.random() * 250);
    response = await fetch(url, init);
  }
  return response;
}
