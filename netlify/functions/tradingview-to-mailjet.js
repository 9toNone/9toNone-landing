// netlify/functions/tradingview-to-mailjet.js
// TradingView -> Netlify -> Mailjet (send to EVERY address in a Mailjet Contact List)
// Uses Node 18 built-in fetch. Batches sends in chunks of 50.

const CHUNK = 50;

exports.handler = async (event) => {
  try {
    // 1) Secret check
    const secret = event.queryStringParameters?.secret || "";
    if (secret !== process.env.ALERT_SECRET) {
      return json(401, { ok: false, error: "Unauthorized (bad secret)" });
    }

    // 2) Parse body
    let payload = {};
    try { payload = JSON.parse(event.body || "{}"); } catch {}
    const symbol   = String(payload.symbol || payload.ticker || "UNKNOWN").toUpperCase();
    const action   = String(payload.action || "signal").toUpperCase();
    const price    = payload.price != null ? String(payload.price) : "—";
    const when     = payload.time || new Date().toISOString();
    const interval = payload.interval != null ? String(payload.interval) : "—";

    // 3) Required env
    const { MAILJET_API_KEY, MAILJET_SECRET_KEY, MAILJET_SENDER, MAILJET_LIST_ID } = process.env;
    if (!MAILJET_API_KEY || !MAILJET_SECRET_KEY || !MAILJET_SENDER || !MAILJET_LIST_ID) {
      return json(500, { ok: false, error: "Missing Mailjet env vars (API key/secret/sender/list id)" });
    }
    const auth = "Basic " + Buffer.from(`${MAILJET_API_KEY}:${MAILJET_SECRET_KEY}`).toString("base64");

    // 4) Fetch emails in the list via /v3/REST/listrecipient (NOT contactslist/contacts)
    const emails = await fetchEmailsFromList(auth, MAILJET_LIST_ID);
    if (!emails.length) {
      return json(200, { ok: true, message: "No active recipients in list; nothing to send." });
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

    // 6) Send in batches of 50
    const batches = chunk(emails, CHUNK);
    const results = [];
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
        return json(502, { ok: false, error: "mailjet-send-failed", status: resp.status, detail: data });
      }
      results.push(data);
    }

    return json(200, { ok: true, message: "Alert sent", recipients: emails.length, batches: batches.length });
  } catch (err) {
    console.error("[tradingview-to-mailjet] fatal", err);
    return json(500, { ok: false, error: "server-error", detail: String(err) });
  }
};

// ---- Helpers ----
function json(code, obj) {
  return { statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}
function chunk(arr, size) { const out=[]; for (let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size)); return out; }

// Pull emails from a Mailjet Contact List via listrecipient
async function fetchEmailsFromList(authHeader, listId) {
  let emails = [];
  let offset = 0;
  const limit = 1000; // per page

  while (true) {
    // Filters:
    //  - ContactsList=ID : which list
    //  - IsActive=true   : only active members
    //  - IsUnsubscribed=false : exclude unsubscribed
    //  - ShowContact=true : include nested Contact object with Email
    const url = `https://api.mailjet.com/v3/REST/listrecipient` +
      `?ContactsList=${encodeURIComponent(listId)}` +
      `&IsActive=true&IsUnsubscribed=false&ShowContact=true` +
      `&Limit=${limit}&Offset=${offset}`;

    const resp = await fetch(url, { headers: { Authorization: authHeader } });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(`listrecipient-fetch-failed: ${JSON.stringify(data)}`);
    }

    const rows = data.Data || [];
    for (const r of rows) {
      const email = r?.Contact?.Email || r?.Email;
      if (email) emails.push(email);
    }

    if (rows.length < limit) break; // last page
    offset += rows.length;
  }

  // dedupe just in case
  return [...new Set(emails)];
}
