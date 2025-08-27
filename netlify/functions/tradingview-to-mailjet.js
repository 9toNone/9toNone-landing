// Netlify Function: tradingview-to-mailjet (robust list fetching)
// Node 18+ => global fetch

const MAILJET_SEND_URL = "https://api.mailjet.com/v3.1/send";
const MJ_BASE = "https://api.mailjet.com/v3/REST";

const {
  ALERT_SECRET,
  MAILJET_API_KEY,
  MAILJET_SECRET_KEY,
  MAILJET_SENDER,
  MAILJET_LIST_ID,
} = process.env;

const basicAuthHeader =
  "Basic " + Buffer.from(`${MAILJET_API_KEY}:${MAILJET_SECRET_KEY}`).toString("base64");

const json = (status, body) => ({
  statusCode: status,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  },
  body: JSON.stringify(body),
});

function s(v, fb = "") {
  return v == null ? fb : String(v);
}

function buildHtml({ symbol, action, price, time, interval }) {
  const sym = s(symbol, "Unknown");
  const act = s(action, "signal").toUpperCase();
  const pri = s(price, "N/A");
  const tim = s(time, new Date().toISOString());
  const intv = s(interval, "");

  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#e6edf3;background:#0b1620;padding:16px">
      <div style="max-width:680px;margin:0 auto;background:#0f1f2d;border-radius:12px;overflow:hidden;border:1px solid #1f3344">
        <div style="background:#0d1a26;padding:16px 20px;border-bottom:1px solid #1f3344">
          <div style="font-size:14px;letter-spacing:.08em;color:#8fb3d9">9toNone</div>
        </div>
        <div style="padding:20px">
          <h2 style="margin:0 0 10px;font-size:20px">🚨 ${act} signal</h2>
          <p style="margin:6px 0"><b>Ticker:</b> ${sym}</p>
          <p style="margin:6px 0"><b>Price:</b> ${pri}</p>
          <p style="margin:6px 0"><b>Time:</b> ${tim}</p>
          ${intv ? `<p style="margin:6px 0"><b>Interval:</b> ${intv}</p>` : ""}
          <p style="margin:16px 0 0;font-size:12px;color:#94a3b8">
            Educational info only. Not financial advice. Trading involves risk.
          </p>
        </div>
      </div>
    </div>
  `;
}

// ---------- Mailjet contact fetching (2 strategies) ----------

// Strategy A (preferred): /contact?ContactsList=<ID>
async function fetchEmailsViaContacts(listId) {
  const url = `${MJ_BASE}/contact?ContactsList=${encodeURIComponent(listId)}&Limit=1000`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: basicAuthHeader, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`contact-fetch-failed: ${t || res.statusText}`);
  }
  const data = await res.json();
  const items = Array.isArray(data.Data) ? data.Data : [];
  // Many accounts get Email right on each item here
  const emails = items.map((it) => it?.Email).filter(Boolean);
  return Array.from(new Set(emails));
}

// Strategy B (fallback): /listrecipient?ContactsList=<ID>&IsActive=true
// Some accounts expose Email here (ContactAlt or Email), others require Contact lookup.
// We’ll try to read any email-like field directly; if not present, returns empty.
async function fetchEmailsViaListRecipient(listId) {
  const url = `${MJ_BASE}/listrecipient?ContactsList=${encodeURIComponent(
    listId
  )}&IsActive=true&Limit=1000`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: basicAuthHeader, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`listrecipient-fetch-failed: ${t || res.statusText}`);
  }
  const data = await res.json();
  const items = Array.isArray(data.Data) ? data.Data : [];

  const candidates = items
    .map((it) => it?.Email || it?.ContactAlt || it?.Contact?.Email) // grab whatever is present
    .filter(Boolean);

  return Array.from(new Set(candidates));
}

async function getListEmailsRobust(listId) {
  // Try strategy A
  try {
    const a = await fetchEmailsViaContacts(listId);
    console.log(`[tradingview-to-mailjet] contacts endpoint returned ${a.length}`);
    if (a.length) return a;
  } catch (e) {
    console.log("[tradingview-to-mailjet] contacts endpoint error:", e.message || e);
  }

  // Fallback to strategy B
  try {
    const b = await fetchEmailsViaListRecipient(listId);
    console.log(`[tradingview-to-mailjet] listrecipient endpoint returned ${b.length}`);
    if (b.length) return b;
  } catch (e) {
    console.log("[tradingview-to-mailjet] listrecipient endpoint error:", e.message || e);
  }

  return [];
}

// ---------- Send ----------
async function mailjetSend({ subject, html, text, fromEmail, fromName, toEmails }) {
  const batches = [];
  for (let i = 0; i < toEmails.length; i += 50) batches.push(toEmails.slice(i, i + 50));

  const payload = {
    Messages: batches.map((batch) => ({
      From: { Email: fromEmail, Name: fromName || "9toNone Alerts" },
      To: batch.map((e) => ({ Email: e })),
      Subject: subject,
      TextPart: text,
      HTMLPart: html,
    })),
  };

  const res = await fetch(MAILJET_SEND_URL, {
    method: "POST",
    headers: { Authorization: basicAuthHeader, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => ({}));
  const ok = res.ok && (body.Messages || []).every((m) => m.Status === "success");
  if (!ok) throw new Error(`mailjet-send-failed: ${JSON.stringify(body)}`);
  return body;
}

// ---------- Handler ----------
exports.handler = async (event) => {
  try {
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
    if (event.httpMethod !== "POST") return json(405, { ok: false, error: "method-not-allowed" });

    const urlSecret = new URLSearchParams(event.queryStringParameters || {}).get("secret");
    if (!ALERT_SECRET || urlSecret !== ALERT_SECRET) return json(401, { ok: false, error: "unauthorized" });

    let payload;
    try {
      payload = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { ok: false, error: "invalid-json" });
    }

    const symbol = s(payload.symbol, "Unknown");
    const action = s(payload.action, "signal");
    const price = s(payload.price, "N/A");
    const time = s(payload.time, new Date().toISOString());
    const interval = s(payload.interval, "");

    if (!MAILJET_LIST_ID) return json(500, { ok: false, error: "missing-env", detail: "MAILJET_LIST_ID" });

    // Fetch recipients (robust)
    const emails = await getListEmailsRobust(MAILJET_LIST_ID);
    console.log(`[tradingview-to-mailjet] final recipient count: ${emails.length}`);

    if (!emails.length) return json(200, { ok: true, message: "No active recipients in list; nothing to send." });

    const subject = `🔔 ${action.toUpperCase()} signal • ${symbol}`;
    const html = buildHtml({ symbol, action, price, time, interval });
    const text =
      `Signal: ${action.toUpperCase()}\n` +
      `Ticker: ${symbol}\n` +
      `Price: ${price}\n` +
      `Time: ${time}\n` +
      (interval ? `Interval: ${interval}\n` : "");

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
