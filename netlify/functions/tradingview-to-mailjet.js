// netlify/functions/tradingview-to-mailjet.js
// Sends TradingView alerts to EVERY email in a Mailjet Contact List.
// - Uses built-in fetch (Node 18+)
// - Fetches list members via Mailjet v3 REST API
// - Sends in chunks of 50 recipients per message

const CHUNK = 50;

exports.handler = async (event) => {
  try {
    // 1) Secret check
    const secret = event.queryStringParameters?.secret || "";
    if (secret !== process.env.ALERT_SECRET) {
      return res(401, { ok: false, error: "Unauthorized (bad secret)" });
    }

    // 2) Parse JSON body
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch {}
    const symbol   = String(body.symbol || body.ticker || "UNKNOWN").toUpperCase();
    const action   = String(body.action || "signal").toUpperCase();
    const price    = body.price != null ? String(body.price) : "—";
    const when     = body.time || new Date().toISOString();
    const interval = body.interval != null ? String(body.interval) : "—";

    // 3) Required env
    const { MAILJET_API_KEY, MAILJET_SECRET_KEY, MAILJET_SENDER, MAILJET_LIST_ID } = process.env;
    if (!MAILJET_API_KEY || !MAILJET_SECRET_KEY || !MAILJET_SENDER || !MAILJET_LIST_ID) {
      return res(500, { ok: false, error: "Missing Mailjet env vars (API key/secret/sender/list id)" });
    }

    // 4) Pull ALL emails from the Mailjet Contact List
    const emails = await fetchListEmails({
      apiKey: MAILJET_API_KEY,
      apiSecret: MAILJET_SECRET_KEY,
      listId: MAILJET_LIST_ID
    });

    if (!emails.length) {
      return res(200, { ok: true, message: "No recipients in list; nothing to send." });
    }

    // 5) Build email content
    const subject = `🔔 ${action} Signal for ${symbol}`;
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:auto;padding:20px;background:#0c1a2a;color:#e6eef6">
        <h2 style="color:#ffd166;margin:0 0 12px">🚨 ${action} Signal</h2>
        <p style="margin:4px 0"><b>Ticker:</b> ${symbol}</p>
        <p style="margin:4px 0"><b>Price:</b> ${price}</p>
        <p style="margin:4px 0"><b>Interval:</b> ${interval}</p>
        <p style="margin:4px 0"><b>Time:</b> ${when}</p>
        <p style="margin-top:16px;color:#7f94ad;font-size:12px">
          Educational only. Not financial advice. Need help? Reply to <b>9tononeassociates@gmail.com</b>
        </p>
      </div>
    `;

    // 6) Send in batches of 50 recipients (Mailjet Send API v3.1)
    const auth = "Basic " + Buffer.from(`${MAILJET_API_KEY}:${MAILJET_SECRET_KEY}`).toString("base64");
    const batches = chunk(emails, CHUNK);
    const sendResults = [];

    for (const batch of batches) {
      const to = batch.map((email) => ({ Email: email }));
      const resp = await fetch("https://api.mailjet.com/v3.1/send", {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          Messages: [{
            From: { Email: MAILJET_SENDER, Name: "9toNone Alerts" },
            To: to,
            Subject: subject,
            HTMLPart: html,
            ReplyTo: { Email: "9tononeassociates@gmail.com", Name: "9toNone Support" },
            CustomID: "tradingview-alert"
          }]
        })
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        return res(502, { ok: false, error: "mailjet-send-failed", status: resp.status, detail: data });
      }
      sendResults.push(data);
    }

    return res(200, { ok: true, message: "Alert sent", recipients: emails.length, batches: batches.length, results: sendResults });
  } catch (err) {
    console.error("[tradingview-to-mailjet] fatal", err);
    return res(500, { ok: false, error: "server-error", detail: String(err) });
  }
};

// ---- helpers ----
function res(code, obj) { return { statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) }; }
function chunk(arr, size) { const out=[]; for (let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size)); return out; }

// Fetch all emails in a Mailjet Contact List (v3 REST)
async function fetchListEmails({ apiKey, apiSecret, listId }) {
  const auth = "Basic " + Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");
  let emails = [];
  let offset = 0;
  const limit = 1000; // max per page

  while (true) {
    const url = `https://api.mailjet.com/v3/REST/contactslist/${encodeURIComponent(listId)}/contacts?Limit=${limit}&Offset=${offset}`;
    const resp = await fetch(url, { headers: { Authorization: auth } });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error("contactslist-fetch-failed: " + JSON.stringify(data));

    const rows = data.Data || [];
    for (const row of rows) {
      // Row format: { Contact: { ID, Email, ... }, IsActive: true, ... }
      const email = row?.Contact?.Email || row?.Email;
      if (email) emails.push(email);
    }
    if (rows.length < limit) break; // last page
    offset += rows.length;
  }

  // de-dupe
  return [...new Set(emails)];
}
