// functions/tradingview-to-mailjet.js
exports.handler = async (event) => {
  const log = (...args) => console.log("[tradingview-to-mailjet]", ...args);

  try {
    // Method + secret
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ ok: false, error: "Method Not Allowed" }) };
    }

    const { ALERT_SECRET, MAILJET_API_KEY, MAILJET_SECRET_KEY, MAILJET_SENDER } = process.env;
    const urlSecret = (event.queryStringParameters && event.queryStringParameters.secret) || "";

    if (!ALERT_SECRET) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: "ALERT_SECRET missing" }) };
    }
    if (urlSecret !== ALERT_SECRET) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: "Unauthorized (bad secret)" }) };
    }

    // Parse JSON
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: "invalid-json" }) };
    }

    const symbol = body.symbol || body.ticker || "Unknown";
    const action = (body.action || "signal").toUpperCase();
    const price = body.price || "—";
    const when  = body.time  || new Date().toISOString();
    const interval = body.interval || "—";

    // Mailjet envs
    if (!MAILJET_API_KEY || !MAILJET_SECRET_KEY || !MAILJET_SENDER) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: "Mailjet env missing" }) };
    }

    // Send to a REAL inbox for validation
    const toEmail = "9tononeassociates@gmail.com"; // change later to your customer(s)

    const subject = `🔔 ${action} Signal for ${symbol}`;
    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial">
        <h2>🚨 ${action} Signal</h2>
        <p><b>Ticker:</b> ${symbol}</p>
        <p><b>Price:</b> ${price}</p>
        <p><b>Interval:</b> ${interval}</p>
        <p><b>Time:</b> ${when}</p>
        <p style="color:#666;font-size:12px">Educational information only; not financial advice.</p>
      </div>
    `;

    // Call Mailjet v3.1 directly (no list, no SDK)
    const auth = Buffer.from(`${MAILJET_API_KEY}:${MAILJET_SECRET_KEY}`).toString("base64");
    const resp = await fetch("https://api.mailjet.com/v3.1/send", {
      method: "POST",
      headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        Messages: [{
          From: { Email: MAILJET_SENDER, Name: "9toNone Alerts" },
          To:   [{ Email: toEmail, Name: "9toNone Team" }],
          Subject: subject,
          HTMLPart: html,
          CustomID: "tradingview-alert"
        }]
      })
    });

    const data = await resp.json().catch(() => ({}));
    log("Mailjet status:", resp.status, "body:", data);

    if (!resp.ok) {
      return { statusCode: 502, body: JSON.stringify({ ok:false, error:"mailjet-send-failed", status:resp.status, detail:data }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok:true, message:"Alert email sent" }) };
  } catch (err) {
    console.error("[tradingview-to-mailjet] fatal:", err);
    return { statusCode: 500, body: JSON.stringify({ ok:false, error:"server-error", detail:String(err) }) };
  }
};
