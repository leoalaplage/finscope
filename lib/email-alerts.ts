import { alertsFor } from "./alerts-feed";
import { evaluate, firesOnce, parseRules, quoteTickers, ruleTickers, RULES_KEY, type Fired } from "./alert-rules";
import { econCalendar } from "./econ";
import { fetchQuotes } from "./adapters/spark";
import { dataKey, readAccount, SUBSCRIBERS_KEY, writeAccount, type Account } from "./accounts";
import { followedTickers, type SyncedData } from "./account-sync";
import { emailConfigured, escapeHtml, sendEmail, type Email } from "./email";
import { datasetCache } from "./runtime-env";

/**
 * The daily email: what the reader's alert rules caught since the last one
 * (lib/alert-rules.ts) — filings, insider purchases, prices crossing their
 * levels, big moves, economic releases — the rules they marked for email,
 * sent after the US close to a verified address that asked for it, never
 * twice in a day and never empty.
 */

const KINDS: Record<Fired["kind"], string> = {
  results: "Results", report: "Report", leadership: "Leadership", flag: "Red flag", insider: "Insider buy", deal: "Deal",
  price: "Price", move: "Big move", econ: "Economy", line: "Chart line",
};
const PER_RUN = 25;
const DAY = 86_400_000;

/** Pure: the email for a list of alerts, or null when there is nothing to say. */
export function alertEmail(to: string, alerts: Array<Pick<Fired, "ticker" | "kind" | "at" | "title" | "detail" | "url">>, site: string, since: string): Email | null {
  if (!alerts.length) return null;
  const tickers = [...new Set(alerts.flatMap((alert) => (alert.ticker ? [alert.ticker] : ["the economy"])))];
  const subject = `Tenqay · ${alerts.length} alert${alerts.length > 1 ? "s" : ""} on ${tickers.slice(0, 4).join(", ")}${tickers.length > 4 ? ` and ${tickers.length - 4} more` : ""}`;
  const link = (url: string) => (url.startsWith("http") ? url : `${site}${url}`);
  const rows = alerts.slice(0, 60).map((alert) => `<tr>
<td style="padding:6px 8px;border-bottom:1px solid #ececed;white-space:nowrap;color:#6f6f76">${escapeHtml(alert.at.slice(0, 10))}</td>
<td style="padding:6px 8px;border-bottom:1px solid #ececed">${alert.ticker ? `<a href="${escapeHtml(`${site}/t/s/${encodeURIComponent(alert.ticker)}`)}" style="color:#08080a;font-weight:600">${escapeHtml(alert.ticker)}</a>` : `<a href="${escapeHtml(`${site}/t/eco`)}" style="color:#08080a;font-weight:600">US</a>`}</td>
<td style="padding:6px 8px;border-bottom:1px solid #ececed;color:#6f6f76">${escapeHtml(KINDS[alert.kind])}</td>
<td style="padding:6px 8px;border-bottom:1px solid #ececed">${escapeHtml(alert.title)}${alert.detail ? `<span style="color:#6f6f76"> · ${escapeHtml(alert.detail)}</span>` : ""} <a href="${escapeHtml(link(alert.url))}" style="color:#6f6f76">${alert.url.startsWith("http") ? "SEC ↗" : "Open ↗"}</a></td>
</tr>`).join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:680px;color:#08080a">
<h2 style="font-size:18px;margin:0 0 4px">What changed for the companies you follow</h2>
<p style="font-size:13px;color:#6f6f76;margin:0 0 12px">What your alerts caught since ${escapeHtml(since)}. <a href="${escapeHtml(`${site}/t/alerts`)}" style="color:#6f6f76">Change your alerts</a>.</p>
<table style="border-collapse:collapse;font-size:13px;width:100%">${rows}</table>
${alerts.length > 60 ? `<p style="font-size:13px;color:#6f6f76">And ${alerts.length - 60} more on <a href="${escapeHtml(`${site}/t/alerts`)}">the alerts page</a>.</p>` : ""}
<p style="font-size:12px;color:#6f6f76;margin-top:16px">From the SEC's filings. Research information, not investment advice. <a href="${escapeHtml(`${site}/t/account`)}" style="color:#6f6f76">Stop these emails</a>.</p>
</div>`;
  const text = [
    "What changed for the companies you follow",
    `Filings and insider purchases since ${since}.`, "",
    ...alerts.slice(0, 60).map((alert) => `${alert.at.slice(0, 10)}  ${alert.ticker ?? "US"}  ${KINDS[alert.kind]}  ${alert.title}${alert.detail ? ` · ${alert.detail}` : ""}  ${link(alert.url)}`),
    "", `Stop these emails: ${site}/t/account`,
  ].join("\n");
  return { to, subject, html, text };
}

/** Whether an account is due its email: once a day, after the US close (21:00 UTC on). */
export function emailDue(account: Account, now: Date): boolean {
  if (!account.email?.verified || !account.email.alerts) return false;
  if (now.getUTCHours() < 21) return false;
  return !account.email.lastSent || now.getTime() - Date.parse(account.email.lastSent) >= 20 * 3_600_000;
}

/** One run of the half-hourly timer: a few dozen accounts' emails, where an email service is configured. */
export async function emailAlertsSlice(site: string, now = new Date()): Promise<{ sent: number; skipped: number } | null> {
  const cache = datasetCache();
  if (!cache || !emailConfigured()) return null;
  const subscribers = (await cache.get<string[]>(SUBSCRIBERS_KEY, "json").catch(() => null)) ?? [];
  let sent = 0, skipped = 0;
  for (const id of subscribers) {
    if (sent + skipped >= PER_RUN) break;
    const account = await readAccount(id);
    if (!account || !emailDue(account, now)) continue;
    const data = (await cache.get<{ items: SyncedData }>(dataKey(id), "json").catch(() => null))?.items ?? {};
    const followed = followedTickers(data);
    // The rules marked for email; an account that has made none has the three defaults.
    const rules = parseRules(data[RULES_KEY]?.value ?? null).filter((rule) => rule.enabled && rule.channels.email);
    const since = (account.email!.lastSent ?? new Date(now.getTime() - DAY).toISOString()).slice(0, 10);
    const tickers = ruleTickers(rules, followed).slice(0, 60);
    const { alerts } = tickers.length ? await alertsFor(tickers, since) : { alerts: [] };
    const priced = quoteTickers(rules);
    const quotes = priced.length ? await fetchQuotes(priced).catch(() => new Map()) : new Map();
    const econ = rules.some((rule) => rule.type === "econ") ? (await econCalendar(3, 0, now).catch(() => ({ events: [] }))).events : [];
    // A price alert is emailed once; the state says which have been (until the reader sets them again).
    const stateKey = `account-alert-state:v1:${id}`;
    const state = (await cache.get<{ fired: Record<string, string> }>(stateKey, "json").catch(() => null)) ?? { fired: {} };
    const armed = rules.map((rule) => (firesOnce(rule.type) && state.fired[rule.id] && (!rule.armedAt || rule.armedAt <= state.fired[rule.id]) ? { ...rule, firedAt: state.fired[rule.id] } : rule));
    const caught = evaluate(armed, {
      followed, alerts, econ, now,
      quotes: Object.fromEntries([...quotes].map(([ticker, quote]) => [ticker, { price: quote.price ?? null, changePercent: quote.changePercent ?? null }])),
    });
    // Since the last email to the second, so nothing is sent twice; a price or a move as it stands now.
    const fresh = caught.filter((alert) => firesOnce(alert.kind) || alert.kind === "move" || !account.email!.lastSent || alert.at > account.email!.lastSent);
    for (const alert of fresh) if (firesOnce(alert.kind)) state.fired[alert.ruleId] = now.toISOString();
    const email = alertEmail(account.email!.address, fresh, site, since);
    if (email) {
      const result = await sendEmail(email);
      if (!result.sent) { skipped++; continue; }
      sent++;
    } else skipped++;
    account.email!.lastSent = now.toISOString();
    await writeAccount(account);
    await cache.put(stateKey, JSON.stringify(state)).catch(() => undefined);
  }
  return { sent, skipped };
}
