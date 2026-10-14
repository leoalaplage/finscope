import { runtimeSecret } from "./runtime-env";

/**
 * Sending an email, through whichever service the site is given a key for.
 *
 * Resend's free tier (3,000 emails a month, 100 a day) covers a daily digest
 * for a hundred readers at no cost, through a plain HTTP call a Worker can
 * make. Nothing is sent, and the account page says so, until the site's owner
 * sets the two secrets: RESEND_API_KEY and ALERTS_FROM ("FinScope
 * <alerts@a-domain-verified-at-resend>").
 */
export interface Email { to: string; subject: string; html: string; text: string }

export function emailConfigured(): boolean {
  return !!runtimeSecret("RESEND_API_KEY") && !!runtimeSecret("ALERTS_FROM");
}

export async function sendEmail(email: Email): Promise<{ sent: boolean; error?: string }> {
  const key = runtimeSecret("RESEND_API_KEY");
  const from = runtimeSecret("ALERTS_FROM");
  if (!key || !from) return { sent: false, error: "No email service is configured." };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [email.to], subject: email.subject, html: email.html, text: email.text }),
  });
  if (response.ok) { await response.body?.cancel(); return { sent: true }; }
  return { sent: false, error: `The email service answered ${response.status}.` };
}

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** A plain message: a heading, paragraphs, an optional button. */
export function plainEmail(to: string, subject: string, heading: string, paragraphs: string[], link?: { href: string; label: string }): Email {
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;color:#08080a">
<h2 style="font-size:18px">${escape(heading)}</h2>
${paragraphs.map((paragraph) => `<p style="font-size:14px;line-height:1.5;color:#4f4f56">${escape(paragraph)}</p>`).join("\n")}
${link ? `<p><a href="${escape(link.href)}" style="display:inline-block;padding:8px 14px;background:#08080a;color:#fff;text-decoration:none;font-size:14px">${escape(link.label)}</a></p>` : ""}
</div>`;
  return { to, subject, html, text: [heading, ...paragraphs, link ? `${link.label}: ${link.href}` : ""].filter(Boolean).join("\n\n") };
}

export { escape as escapeHtml };
