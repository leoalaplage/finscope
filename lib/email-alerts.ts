import type { Alert } from "./alerts";
import { alertsFor } from "./alerts-feed";
import { dataKey, readAccount, SUBSCRIBERS_KEY, writeAccount, type Account } from "./accounts";
import { followedTickers, type SyncedData } from "./account-sync";
import { emailConfigured, escapeHtml, sendEmail, type Email } from "./email";
import { datasetCache } from "./runtime-env";

/**
 * The daily email: what changed for the companies an account follows since
 * the last one — results, reports, leadership changes, deals, red flags,
 * insider purchases — sent after the US close, to verified addresses that
 * asked for it, never twice in a day and never empty.
 */

const KINDS: Record<Alert["kind"], string> = { results: "Results", report: "Report", leadership: "Leadership", flag: "Red flag", insider: "Insider buy", deal: "Deal" };
const PER_RUN = 25;
const DAY = 86_400_000;

/** Pure: the email for a list of alerts, or null when there is nothing to say. */
export function alertEmail(to: string, alerts: Alert[], site: string, since: string): Email | null {
  if (!alerts.length) return null;
  const tickers = [...new Set(alerts.map((alert) => alert.ticker))];
  const subject = `FinScope · ${alerts.length} alert${alerts.length > 1 ? "s" : ""} on ${tickers.slice(0, 4).join(", ")}${tickers.length > 4 ? ` and ${tickers.length - 4} more` : ""}`;
  const rows = alerts.slice(0, 60).map((alert) => `<tr>
<td style="padding:6px 8px;border-bottom:1px solid #ececed;white-space:nowrap;color:#6f6f76">${escapeHtml(alert.at.slice(0, 10))}</td>
<td style="padding:6px 8px;border-bottom:1px solid #ececed"><a href="${escapeHtml(`${site}/t/s/${encodeURIComponent(alert.ticker)}`)}" style="color:#08080a;font-weight:600">${escapeHtml(alert.ticker)}</a></td>
<td style="padding:6px 8px;border-bottom:1px solid #ececed;color:#6f6f76">${escapeHtml(KINDS[alert.kind])}</td>
<td style="padding:6px 8px;border-bottom:1px solid #ececed">${escapeHtml(alert.title)}${alert.detail ? `<span style="color:#6f6f76"> · ${escapeHtml(alert.detail)}</span>` : ""} <a href="${escapeHtml(alert.url)}" style="color:#6f6f76">SEC ↗</a></td>
</tr>`).join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:680px;color:#08080a">
<h2 style="font-size:18px;margin:0 0 4px">What changed for the companies you follow</h2>
<p style="font-size:13px;color:#6f6f76;margin:0 0 12px">Filings and insider purchases since ${escapeHtml(since)}.</p>
<table style="border-collapse:collapse;font-size:13px;width:100%">${rows}</table>
${alerts.length > 60 ? `<p style="font-size:13px;color:#6f6f76">And ${alerts.length - 60} more on <a href="${escapeHtml(`${site}/t/alerts`)}">the alerts page</a>.</p>` : ""}
<p style="font-size:12px;color:#6f6f76;margin-top:16px">From the SEC's filings. Research information, not investment advice. <a href="${escapeHtml(`${site}/t/account`)}" style="color:#6f6f76">Stop these emails</a>.</p>
</div>`;
  const text = [
    "What changed for the companies you follow",
    `Filings and insider purchases since ${since}.`, "",
    ...alerts.slice(0, 60).map((alert) => `${alert.at.slice(0, 10)}  ${alert.ticker}  ${KINDS[alert.kind]}  ${alert.title}${alert.detail ? ` · ${alert.detail}` : ""}  ${alert.url}`),
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
    const tickers = followedTickers(data).slice(0, 60);
    const since = (account.email!.lastSent ?? new Date(now.getTime() - DAY).toISOString()).slice(0, 10);
    const { alerts } = tickers.length ? await alertsFor(tickers, since) : { alerts: [] };
    // Alerts since the last email to the second, so a filing is never sent twice.
    const fresh = alerts.filter((alert) => !account.email!.lastSent || alert.at > account.email!.lastSent);
    const email = alertEmail(account.email!.address, fresh, site, since);
    if (email) {
      const result = await sendEmail(email);
      if (!result.sent) { skipped++; continue; }
      sent++;
    } else skipped++;
    account.email!.lastSent = now.toISOString();
    await writeAccount(account);
  }
  return { sent, skipped };
}
