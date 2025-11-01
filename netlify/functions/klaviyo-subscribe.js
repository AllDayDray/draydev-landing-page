// netlify/functions/klaviyo-subscribe.js
const ok = {
  'Access-Control-Allow-Origin': 'https://drayishere.com',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: ok, body: 'ok' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: ok, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { name, email, businessType } = JSON.parse(event.body || '{}');
    if (!email || !businessType) {
      return { statusCode: 400, headers: ok, body: JSON.stringify({ error: 'Missing email or businessType' }) };
    }

    const res = await fetch(`https://a.klaviyo.com/api/v2/list/${process.env.KLAVIYO_LIST_ID}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.KLAVIYO_PRIVATE_KEY,
        profiles: [{
          email,
          first_name: name || undefined,
          $consent: ['email'],
          businessType,
          $source: 'drayishere.com'
        }]
      })
    });

    const data = await res.json();
    if (!res.ok) {
      return { statusCode: 502, headers: ok, body: JSON.stringify({ error: 'Klaviyo subscribe failed', details: data }) };
    }

    return { statusCode: 200, headers: ok, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, headers: ok, body: JSON.stringify({ error: 'Server error' }) };
  }
};
