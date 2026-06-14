import { config } from "../config.js";

// Invia un'email via Resend. Fallback dev (nessuna RESEND_API_KEY): logga in console.
export async function sendEmail({ to, subject, html }) {
  if (!config.resendApiKey) {
    console.log(
      `\n[mailer:dev] (nessuna RESEND_API_KEY)\n  to: ${to}\n  subject: ${subject}\n  body: ${html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}\n`
    );
    return { dev: true };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from: config.mailFrom, to, subject, html }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[mailer] resend failed", res.status, detail);
    throw new Error("email_send_failed");
  }
  return res.json();
}

export function magicLinkEmail(url) {
  return {
    subject: "Your WaitingAds sign-in link",
    html:
      `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">` +
      `<p>Click the button below to sign in to your <strong>Advertiser Console</strong>:</p>` +
      `<p><a href="${url}" style="display:inline-block;background:#0E8A5F;color:#fff;padding:12px 22px;text-decoration:none;border-radius:6px">Sign in to WaitingAds</a></p>` +
      `<p style="color:#6b7280;font-size:13px">Or paste this link: <br>${url}</p>` +
      `<p style="color:#6b7280;font-size:13px">This link expires in 30 minutes. If you didn't request it, ignore this email.</p>` +
      `</div>`,
  };
}
