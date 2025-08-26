// netlify/functions/tradingview-to-mailjet.js
exports.handler = async (event) => {
  try {
    // 1) Secret check
    const secret = event.queryStringParameters?.secret || "";
    if (secret !== process.env.ALERT_SECRET) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: "Unauthorized" }) };
    }

    // 2) Parse JSON
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch { }
    const symbol   = (body.symbol || body.ticker || "Unknown").toString().toUpperCase();
    const action   = (body.action || "signal").toString().toUpperCase();
    const price    = String(body.price ?? "—");
    const when     = body.time || new Date().toISOString();
    const interval = String(body.interval ?? "—");

    // 3) Mailjet auth
    const { MAILJET_API_KEY, MAILJET_SECRET_KEY, MAILJET_SENDER, MAILJET_LIST_ID } = process.env;
    if (!MAILJET_API_KEY || !MAILJET_SECRET_KEY || !MAILJET_SENDER || !MAILJET_LIST_ID) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: "Missing Mailjet env vars" }) };
    }
    const auth = Buffer.from(`${MAILJET_API_KEY}:${MAILJET_SECRET_KEY}`).toString("base64");

    // 4) Email content
    const subject = `🔔 ${action} Signal for ${symbol}`;
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:auto;padding:20px;background:#0c1a2a;color:#e6eef6">
        <h2 style="color:#ffd166">🚨 ${action} Signal</h2>
        <p><b>Ticker:</b> ${symbol}</p>
        <p><b>Price:</b> ${price}</p>
        <p><b>Interval:</b> ${interval}</p>
        <p><b>Time:</b> ${when}</p>
        <p style="margin-top:20px;color:#7f94ad;font-size:12px">
          Educational only. Not financial advice.<br>
          Questions? Reply to <b>9tononeassociates@gmail.com</b>
        </p>
      </div>
    `;

    // 5) Send to your Mailjet Contact List (use the 'contactslist' target)
    const resp = await fetch("https://api.mailjet.com/v3.1/send", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        Messages: [
          {
            From: { Email: MAILJET_SENDER, Name: "9toNone Alerts" },
            To: [{ Email: "contactslist", Name: MAILJET_LIST_ID }],
            Subject: subject,
            HTMLPart: html,
            ReplyTo: { Email: "9tononeassociates@gmail.com", Name: "9toNone Support" },
            CustomID: "tradingview-alert"
          },
        ],
      }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return { statusCode: 502, body: JSON.stringify({ ok: false, error: "mailjet-send-failed", detail: data }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, message: "Alert sent to list" }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(err) }) };
  }
};
