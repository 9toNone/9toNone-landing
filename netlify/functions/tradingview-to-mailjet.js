const mailjet = require('node-mailjet');

exports.handler = async (event) => {
  try {
    // ✅ Validate secret
    const secret = event.queryStringParameters.secret;
    if (secret !== process.env.ALERT_SECRET) {
      return { statusCode: 403, body: "Forbidden: Invalid secret" };
    }

    // ✅ Parse TradingView payload
    const data = JSON.parse(event.body);

    const type = data.type || "signal";
    const ticker = data.ticker || "Unknown";
    const price = data.price || "N/A";
    const confidence = data.confidence || "N/A";
    const timestamp = data.timestamp || new Date().toISOString();

    // ✅ Build email content
    const subject = `🔔 ${type.toUpperCase()} Signal for ${ticker}`;
    const messageText = `
      Signal: ${type.toUpperCase()}
      Ticker: ${ticker}
      Price: ${price}
      Confidence: ${confidence}
      Time: ${timestamp}
    `;

    // ✅ Initialize Mailjet client
    const mj = mailjet.apiConnect(
      process.env.MAILJET_API_KEY,
      process.env.MAILJET_SECRET_KEY
    );

    // ✅ Send email to entire contact list
    const request = mj.post("send", { version: "v3.1" }).request({
      Messages: [
        {
          From: {
            Email: process.env.MAILJET_SENDER,
            Name: "9toNone Alerts"
          },
          To: [
            {
              Email: "contactslist", // special Mailjet option to target a list
              Name: process.env.MAILJET_LIST_ID
            }
          ],
          Subject: subject,
          TextPart: messageText,
          HTMLPart: `
            <h2>🚨 ${type.toUpperCase()} Signal</h2>
            <p><b>Ticker:</b> ${ticker}</p>
            <p><b>Price:</b> ${price}</p>
            <p><b>Confidence:</b> ${confidence}</p>
            <p><b>Time:</b> ${timestamp}</p>
          `
        }
      ]
    });

    const result = await request;
    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Alert email sent!", result: result.body })
    };

  } catch (error) {
    console.error("Error sending alert email:", error);
    return { statusCode: 500, body: "Internal Server Error" };
  }
};
