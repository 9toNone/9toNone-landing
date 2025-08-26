// functions/tradingview-to-mailjet.js
const fetch = require("node-fetch");

exports.handler = async (event) => {
  try {
    // 1) Secret check
    if (event.queryStringParameters.secret !== process.env.ALERT_SECRET) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: "Unauthorized" }) };
    }

    // 2) Parse JSON
    const body = JSON.parse(event.body || "{}");
    const symbol = body.symbol || "Unknown";
    const action = (body.action || "signal").toUpperCase();
    const price = body.price || "—";
    const when = body.time || new Date().toISOString();
    const interval = body.interval || "—";

    // 3) Mailjet setup
    const auth = Buffer.from(
      `${process.env.MAILJET_API_KEY}:${process.env.MAILJET_SECRET_KEY}`
    ).toString("base64");

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

    // 4) Send to a whole Contact List
    const resp = await fetch("https://api.mailjet.com/v3.1/send", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        Messages: [
          {
            From: { Email: process.env.MAILJET_SENDER, Name: "9toNone Alerts" },
            To: [{ Email: "contactslist", Name: process.env.MAILJET_LIST_ID }],
            Subject: subject,
            HTMLPart: html,
            ReplyTo: { Email: "9tononeassociates@gmail.com", Name: "9toNone Support" },
          },
        ],
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      return { statusCode: 502, body: JSON.stringify({ ok: false, error: data }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, message: "Alert sent to list" }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(err) }) };
  }
};
