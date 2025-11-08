// Build Better Blueprint / Freelance Ad Form → Klaviyo Integration
// ✅ CommonJS (Netlify legacy runtime) + smart list routing

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const KLAVIYO_KEY = process.env.KLAVIYO_PRIVATE_KEY;
const LIST_ID_DEFAULT = process.env.KLAVIYO_LIST_ID_BBB || process.env.KLAVIYO_LIST_ID; // BBB fallback
const LIST_ID_FREELANCE = process.env.KLAVIYO_LIST_ID_FREELANCE; // Freelance Ad List
const REVISION = '2023-12-15';

const ok = {
  'Access-Control-Allow-Origin': 'https://drayishere.com',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

function pickListId(body, headers) {
  // 1) Explicit flag from page takes priority
  const listFlag = (body.list || '').toLowerCase();

  if (listFlag === 'freelance' && LIST_ID_FREELANCE) return LIST_ID_FREELANCE;
  if (listFlag === 'bbb' && LIST_ID_DEFAULT) return LIST_ID_DEFAULT;

  // 2) Fallback: detect from Referer URL
  const ref = headers.referer || headers.Referer || '';
  if (/\/book\/?$/i.test(ref) && LIST_ID_FREELANCE) return LIST_ID_FREELANCE;

  // 3) Default = BBB
  return LIST_ID_DEFAULT;
}

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

    // E.164 (US) format for Klaviyo
    if (phone) phone = '+1' + phone.replace(/\D/g, '');

    if (!email) {
      return { statusCode: 400, headers: ok, body: JSON.stringify({ error: 'Missing email' }) };
    }

    // Choose correct list
    const LIST_ID = pickListId(body, event.headers);
    if (!LIST_ID) {
      return {
        statusCode: 500,
        headers: ok,
        body: JSON.stringify({ error: 'No list configured', details: 'Set KLAVIYO_LIST_ID_BBB and KLAVIYO_LIST_ID_FREELANCE in Netlify env vars.' })
      };
    }

    // Create/update profile
    const payload = {
      data: {
        type: 'profile',
        attributes: {
          email,
          first_name: name || undefined,
          phone_number: phone || undefined,
          properties: {
            primaryNeed: primaryNeed || undefined,
            source: body.list === 'freelance' ? 'Freelance Ad Form' : 'Build Better Blueprint Form'
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
    if (!res.ok) {
      return { statusCode: res.status, headers: ok, body: JSON.stringify({ error: 'Profile update failed', details: data }) };
    }

    // Add to the chosen list
    const rel = await fetch(`https://a.klaviyo.com/api/lists/${LIST_ID}/relationships/profiles/`, {
      method: 'POST',
      headers: {
        Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`,
        Accept: 'application/json',
        revision: REVISION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ data: [{ type: 'profile', id: data.data.id }] })
    });

    if (!rel.ok) {
      const relErr = await rel.text();
      return { statusCode: rel.status, headers: ok, body: JSON.stringify({ error: 'List add failed', details: relErr }) };
    }

    return { statusCode: 200, headers: ok, body: JSON.stringify({ ok: true, list: LIST_ID }) };
  } catch (err) {
    console.error('Function error:', err);
    return { statusCode: 500, headers: ok, body: JSON.stringify({ error: 'Server error', details: err.message }) };
  }
};
