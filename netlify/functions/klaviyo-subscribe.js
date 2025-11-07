// Build Better Blueprint / Freelance Ad Form → Klaviyo Integration
// ✅ Compatible with Netlify’s CommonJS runtime

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const KLAVIYO_KEY = process.env.KLAVIYO_PRIVATE_KEY;
const LIST_ID = process.env.KLAVIYO_LIST_ID;
const REVISION = '2023-12-15';

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
    const body = JSON.parse(event.body || '{}');
    const name = body.name?.trim() || '';
    const email = body.email?.trim() || '';
    const primaryNeed = body.primary_need?.trim() || '';
    let phone = (body.phone || '').trim();

    // ✅ Format phone for Klaviyo (E.164 format)
    if (phone && !phone.startsWith('+1')) {
      phone = '+1' + phone.replace(/\D/g, '');
    }

    if (!email) {
      return {
        statusCode: 400,
        headers: ok,
        body: JSON.stringify({ error: 'Missing email' })
      };
    }

    // Create or update profile in Klaviyo
    const payload = {
      data: {
        type: 'profile',
        attributes: {
          email,
          first_name: name,
          phone_number: phone || undefined,
          properties: {
            primaryNeed,
            source: 'Freelance Ad Form'
          }
        }
      }
    };

    const res = await fetch('https://a.klaviyo.com/api/profiles/', {
      method: 'POST',
      headers: {
        Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`,
        Accept: 'application/json',
        revision: REVISION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    console.log('Klaviyo response:', data);

    if (!res.ok) {
      return {
        statusCode: res.status,
        headers: ok,
        body: JSON.stringify({ error: 'Profile update failed', details: JSON.stringify(data) })
      };
    }

    // Add to list
    await fetch(`https://a.klaviyo.com/api/lists/${LIST_ID}/relationships/profiles/`, {
      method: 'POST',
      headers: {
        Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`,
        Accept: 'application/json',
        revision: REVISION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        data: [{ type: 'profile', id: data.data.id }]
      })
    });

    return {
      statusCode: 200,
      headers: ok,
      body: JSON.stringify({ ok: true })
    };

  } catch (err) {
    console.error('Function error:', err);
    return {
      statusCode: 500,
      headers: ok,
      body: JSON.stringify({ error: 'Server error', details: err.message })
    };
  }
};
