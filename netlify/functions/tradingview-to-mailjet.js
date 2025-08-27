// Netlify Function: tradingview-to-mailjet
// Sends a TradingView alert email to every ACTIVE recipient on a Mailjet Contact List
// Uses Mailjet v3.1 Send API + v3 REST listrecipient endpoint
// Node 18+ on Netlify => use global fetch (no node-fetch needed)

const MAILJET_SEND_URL = "https://api.mailjet.com/v3.1/send";
const MJ_BASE = "https://api.mailjet.com/v3/REST";

const {
  ALERT_SECRET,
  MAILJET_API_KEY,
  MAILJET_SECRET_KEY,
  MAILJET_SENDER,
  MAILJET_LIST_ID,
} = process.env;

const basicAuthHeader = "Basic " + Buffer.from(`${MAILJET_API_KEY}:${MAILJET_SECRET_KEY}`).toString("base64");

// -------- helpers --------
const json = (status, body) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

function ensureString(v, fallback = "") {
  return (v === undefined || v === null) ? fallback : String(v);
}

function buildHtml({ symbol, action, price, time, interval }) {
  const safeSymbol = ensureString(symbol, "Unknown");
  const safeAction = ensureString(action, "signal").toUpperCase();
  const safePrice  = ensureString(price, "N/A");
  const safeTime   = ensureString(time, new Date().toISOString());
  const safeInt    = ensureString(interval, "");

  return `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color:#e6edf3; background:#0b1620; padding:16px;">
      <div style="max-width:680px; margin:0 auto; background:#0f1f2d; border-radius:12px; overflow:hidden; border:1px solid #1f3344;">
        <div style="background:#0d1a26; padding:16px 20px; border-bottom:1px solid #1f3344;">
          <div style="font-size:14px; letter-spacing:.08em; color:#8fb3d9;">9toNone</div>
        </div>
        <div style="padding:20px;">
          <h2 style="margin:0 0 10px; font-size:20px;">🚨 ${safeAction} signal</h2>
          <p style="margin:6px 0;"><b>Ticker:</b> ${safeSymbol}</p>
          <p style="margin:6px 0;"><b>Price:</b> ${safePrice}</p>
          <p style="margin:6px 0;"><b>Time:</b> ${safeTime}</p>
          ${safeInt ? `<p style="margin:6px 0;"><b>Interval:</b> ${safeInt}</p>` : ""}
          <p style="margin:16px 0 0; font-size:12px; color:#94a3b8;">Educational info only. Not financial advice. Trading involves risk.</p>
        </div>
      </div>
    </div>
  `;
}

// Pull all ACTIVE emails on a Mailjet list using /listrecipient
async function fetchActiveEmailsFromList(listId) {
  // include=Contact adds the nested Contact object so we can read Contact.Email
  const url = `${MJ_BASE}/listrecipient?ContactsList=${encodeURIComponent(listId)}&IsActive=true&Limit=1000&include=Contact`;

  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: basicAuthHeader, "Content-Type": "application/json" },
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`contactslist-fetch-failed: ${detail || res.statusText}`);
  }

  const data = await res.json();
  const items = Array.isArray(data.Data) ? data.Data : [];

  // Extract emails
  const emails = items
    .map(it => it?.Contact?.Email)
    .filter(Boolean);

  // Deduplicate just in case
  return Array.from(new Set(emails));
}

async function mailjetSend({ subject, html, text, fromEmail, fromName, toEmails }) {
  // Mailjet supports up to 50 recipients per Messages[i].To
  // If more, split into batches
  const batches = [];
  for (let i = 0; i < toEmails.length; i += 50) {
    batches.push(toEmails.slice(i, i + 50));
  }

  const payload = {
    Messages: batches.map(batch => ({
      From: { Email: fromEmail, Name: fromName || "9toNone Alerts" },
      To: batch.map(e => ({ Email: e })),
      Subject: subject,
      TextPart: text,
      HTMLPart: html
    }))
  };

  const res = await fetch(MAILJET_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok || (body.Messages || []).some(m => m.Status !== "success")) {
    throw new Error(`mailjet-send-failed: ${JSON.stringify(body)}`);
  }

  return body;
}

// -------- handler --------
exports.handler = async (event) => {
  try {
    // CORS preflight
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
        body: "",
      };
    }

    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "method-not-allowed" });
    }

    // simple secret gate
    const urlSecret = new URLSearchParams(event.queryStringParameters || {}).get("secret");
    if (!ALERT_SECRET || urlSecret !== ALERT_SECRET) {
      return json(401, { ok: false, error: "unauthorized" });
    }

    // parse TradingView payload
    let payload;
    try {
      payload = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { ok: false, error: "invalid-json" });
    }

    const symbol   = ensureString(payload.symbol, "Unknown");
    const action   = ensureString(payload.action, "signal");
    const price    = ensureString(payload.price, "N/A");
    const time     = ensureString(payload.time, new Date().toISOString());
    const interval = ensureString(payload.interval, "");

    // fetch recipients from the Mailjet list (active only)
    const listId = MAILJET_LIST_ID;
    if (!listId) return json(500, { ok: false, error: "missing-env", detail: "MAILJET_LIST_ID" });

    const emails = await fetchActiveEmailsFromList(listId);

    if (!emails.length) {
      return json(200, { ok: true, message: "No active recipients in list; nothing to send." });
    }

    // build content
    const subject = `🔔 ${action.toUpperCase()} signal • ${symbol}`;
    const html = buildHtml({ symbol, action, price, time, interval });
    const text =
      `Signal: ${action.toUpperCase()}\n` +
      `Ticker: ${symbol}\n` +
      `Price: ${price}\n` +
      `Time: ${time}\n` +
      (interval ? `Interval: ${interval}\n` : "");

    // send
    await mailjetSend({
      subject,
      html,
      text,
      fromEmail: MAILJET_SENDER || "alerts@9tonone.com",
      fromName: "9toNone Alerts",
      toEmails: emails,
    });

    return json(200, { ok: true, message: "Alert email sent", recipients: emails.length });

  } catch (err) {
    console.error("TradingView function error:", err?.message || err);
    return json(500, { ok: false, error: "server-error", detail: String(err?.message || err) });
  }
};
