// Receives Gumroad webhook and adds buyer to a Mailjet list.

const parseBody = async (req) => {
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('application/json')) return await req.json();
  const text = await req.text();
  const params = new URLSearchParams(text);
  const obj = {};
  for (const [k, v] of params.entries()) obj[k] = v;
  if (obj.payload) { try { return JSON.parse(obj.payload); } catch {} }
  return obj;
};

const addContactToMailjet = async ({ email, name }) => {
  const listId = process.env.MAILJET_LIST_ID;
  const key = process.env.MAILJET_API_KEY;
  const secret = process.env.MAILJET_API_SECRET;
  if (!key || !secret || !listId) throw new Error('Missing Mailjet env vars');

  const auth = Buffer.from(`${key}:${secret}`).toString('base64');
  const url = `https://api.mailjet.com/v3/REST/contactslist/${listId}/managecontact`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      Email: email,
      Name: name || '',
      Action: 'addnoforce' // safe: won’t re-subscribe someone who unsubscribed
    })
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Mailjet managecontact failed: ${resp.status} ${t}`);
  }
};

export default async (req) => {
  try {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    const data = await parseBody(req);

    // Basic authenticity check
    const expected = process.env.GUMROAD_SELLER_ID;
    const got = data.seller_id || data.sellerId || data.sellerID;
    if (!expected) return new Response('Missing GUMROAD_SELLER_ID', { status: 500 });
    if (!got || got !== expected) return new Response('Forbidden', { status: 403 });

    // Extract purchaser info
    const email = data.email || data.buyer_email || data.purchaser_email || '';
    const name  = data.full_name || data.buyer_name || data.licensee || '';
    if (!email) return new Response('Missing email', { status: 400 });

    await addContactToMailjet({ email, name });

    return new Response('OK', { status: 200 });
  } catch (err) {
    return new Response(`Server error: ${err.message}`, { status: 500 });
  }
};
