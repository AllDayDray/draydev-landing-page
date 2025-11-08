// Klaviyo Integration — BBB vs Freelance routing (no node-fetch needed)

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
  const flag = (body.list || '').toLowerCase();
  if (flag === 'freelance' && LIST_ID_FREELANCE) return LIST_ID_FREELANCE;
  if (flag === 'bbb' && LIST_ID_DEFAULT) return LIST_ID_DEFAULT;

  const ref = headers.referer || headers.Referer || '';
  if (/\/book\/?$/i.test(ref) && LIST_ID_FREELANCE) return LIST_ID_FREELANCE;

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
    const name = (body.name || '').trim();
    const email = (body.email || '').trim();
    const primaryNeed = (body.primary_need || '').trim();
    let phone = (body.phone || '').trim();
    if (!email) return { statusCode: 400, headers: ok, body: JSON.stringify({ error: 'Missing email' }) };

    // E.164 (US)
    if (phone) phone = '+1' + phone.replace(/\D/g, '');

    const LIST_ID = pickListId(body, event.headers);
    if (!LIST_ID) {
      return { statusCode: 500, headers: ok, body: JSON.stringify({ error: 'No list configured' }) };
    }

    // Create/update profile
    const profileRes = await fetch('https://a.klaviyo.com/api/profiles/', {
      method: 'POST',
      headers: {
        Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`,
        Accept: 'application/json',
        revision: REVISION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
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
      })
    });
    const profileJson = await profileRes.json();
    if (!profileRes.ok) {
      return { statusCode: profileRes.status, headers: ok, body: JSON.stringify({ error: 'Profile update failed', details: profileJson }) };
    }

    // Add to chosen list
    const relRes = await fetch(`https://a.klaviyo.com/api/lists/${LIST_ID}/relationships/profiles/`, {
      method: 'POST',
      headers: {
        Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`,
        Accept: 'application/json',
        revision: REVISION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ data: [{ type: 'profile', id: profileJson.data.id }] })
    });

    if (!relRes.ok) {
      const t = await relRes.text();
      return { statusCode: relRes.status, headers: ok, body: JSON.stringify({ error: 'List add failed', details: t }) };
    }

    return { statusCode: 200, headers: ok, body: JSON.stringify({ ok: true, list: LIST_ID }) };
  } catch (err) {
    console.error('Function error:', err);
    return { statusCode: 500, headers: ok, body: JSON.stringify({ error: 'Server error', details: err.message }) };
  }
};
