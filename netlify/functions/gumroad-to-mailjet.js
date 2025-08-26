// netlify/functions/gumroad-to-mailjet.js
const Mailjet = require('node-mailjet');

exports.handler = async (event) => {
  try {
    // 1) Method check
    if (event.httpMethod !== 'POST') {
      return json(405, { error: 'Method Not Allowed. Use POST.' });
    }

    // 2) Secret check (QUERY STRING)
    const urlSecret = (event.queryStringParameters && event.queryStringParameters.secret) || '';
    const envSecret = process.env.GUMROAD_SECRET || '';

    // Help in debugging without leaking secrets
    console.log('[Auth] providedSecretLen:', urlSecret.length, 'envSecretLen:', envSecret.length);

    if (!envSecret) {
      return json(500, { error: 'Server misconfiguration: GUMROAD_SECRET is not set.' });
    }
    if (!urlSecret || urlSecret !== envSecret) {
      return json(403, { error: 'Forbidden: secret mismatch.' });
    }

    // 3) Parse body
    let payload = {};
    try {
      payload = JSON.parse(event.body || '{}');
    } catch (e) {
      return json(400, { error: 'Invalid JSON body.' });
    }

    // 4) Extract fields with safe defaults
    const {
      email,
      full_name,
      product_name,
      variants,
      price,
      currency,
      purchase_timestamp,
    } = payload;

    if (!email) {
      return json(400, { error: 'Missing required field: email' });
    }

    // 5) Prepare Mailjet client
    const MJ_API_KEY = process.env.MAILJET_API_KEY;
    const MJ_SECRET_KEY = process.env.MAILJET_SECRET_KEY;
    const MJ_SENDER = process.env.MAILJET_SENDER; // e.g. "9toNone <no-reply@9tonone.com>"

    if (!MJ_API_KEY || !MJ_SECRET_KEY || !MJ_SENDER) {
      return json(500, {
        error:
          'Server misconfiguration: MAILJET_API_KEY, MAILJET_SECRET_KEY, and MAILJET_SENDER must be set.',
      });
    }

    const mailjet = Mailjet.apiConnect(MJ_API_KEY, MJ_SECRET_KEY);

    // 6) Build email
    const subject = '🎉 Welcome to 9toNone – You’re In!';
    const priceDollars =
      typeof price === 'number' && Number.isFinite(price) ? (price / 100).toFixed(2) : null;

    const textBody = [
      `Hi${full_name ? ' ' + full_name : ''},`,
      '',
      `Thanks for subscribing to 9toNone Real-Time Trade Alerts.`,
      '',
      `Product: ${product_name || 'N/A'}`,
      `Plan/Tier: ${variants || 'N/A'}`,
      priceDollars ? `Amount: $${priceDollars} ${currency || ''}`.trim() : undefined,
      purchase_timestamp ? `Purchased at: ${purchase_timestamp}` : undefined,
      '',
      'What to expect:',
      '• Frequency: 3–5 alert emails per day (market dependent).',
      '• Each alert includes ticker, direction (BUY/SELL/EXIT), price-level and timestamp.',
      '',
      'Where to trade (affiliate links):',
      '• Robinhood — https://join.robinhood.com/ilyask10',
      '• Moomoo — https://j.moomoo.com/0rdJ9f',
      '',
      'Important: All alerts are educational — this is not financial advice.',
      '',
      'Need help? Email us at 9tononeassociates@gmail.com',
    ]
      .filter(Boolean)
      .join('\n');

    const htmlBody = `
      <div style="font-family:Inter, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color:#e6edf3;">
        <h2 style="margin-top:0;">🎉 Welcome — you’re in!</h2>
        <p>Thanks for subscribing to <strong>9toNone Real-Time Trade Alerts</strong>.</p>
        <table style="margin:12px 0 18px 0;">
          <tr><td><strong>Product:</strong></td><td>${escapeHtml(product_name || 'N/A')}</td></tr>
          <tr><td><strong>Plan/Tier:</strong></td><td>${escapeHtml(variants || 'N/A')}</td></tr>
          ${
            priceDollars
              ? `<tr><td><strong>Amount:</strong></td><td>$${priceDollars} ${escapeHtml(
                  currency || ''
                )}</td></tr>`
              : ''
          }
          ${
            purchase_timestamp
              ? `<tr><td><strong>Purchased at:</strong></td><td>${escapeHtml(
                  purchase_timestamp
                )}</td></tr>`
              : ''
          }
        </table>
        <h3>What to expect</h3>
        <ul>
          <li>Frequency: 3–5 alert emails per day (market dependent).</li>
          <li>Each alert includes ticker, direction (BUY/SELL/EXIT), price level, and timestamp.</li>
        </ul>

        <h3>Where to trade</h3>
        <ul>
          <li><a href="https://join.robinhood.com/ilyask10">Robinhood</a> — simple app-based trading, beginner-friendly.</li>
          <li><a href="https://j.moomoo.com/0rdJ9f">Moomoo</a> — advanced charts & tools, great for active traders.</li>
        </ul>

        <p style="margin-top:16px; font-size:12px; color:#93c5fd;">
          Disclaimer: 9toNone LLC provides educational information only and does not offer financial or investment advice.
          Trading involves risk.
        </p>

        <p style="font-size:12px;">Need help? Email us at <a href="mailto:9tononeassociates@gmail.com">9tononeassociates@gmail.com</a></p>
      </div>
    `;

    // 7) Send email
    console.log('[Mailjet] sending to:', email);

    const request = await mailjet.post('send', { version: 'v3.1' }).request({
      Messages: [
        {
          From: { Email: extractEmail(MJ_SENDER), Name: extractName(MJ_SENDER) || '9toNone' },
          To: [{ Email: email, Name: full_name || '' }],
          Subject: subject,
          TextPart: textBody,
          HTMLPart: htmlBody,
          CustomID: 'gumroad_welcome_v1',
        },
      ],
    });

    console.log('[Mailjet] response:', request.body);

    return json(200, { ok: true, message: 'Welcome email sent', mailjetId: request.body?.Messages?.[0]?.To?.[0]?.MessageUUID || null });
  } catch (err) {
    console.error('[Function error]', err);
    return json(500, { error: 'Internal Server Error', details: String(err && err.message || err) });
  }
};

// Helpers
function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function extractEmail(sender) {
  // supports "Name <email@domain.com>" or just "email@domain.com"
  const m = /<(.*)>/.exec(sender || '');
  return (m && m[1]) || sender || '';
}
function extractName(sender) {
  const m = /^(.*?)\s*</.exec(sender || '');
  return (m && m[1]) || '';
}
