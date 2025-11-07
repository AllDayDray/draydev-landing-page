// netlify/functions/klaviyo-subscribe.js

const PROD_ORIGIN = 'https://drayishere.com';
const KLAVIYO_KEY = process.env.KLAVIYO_PRIVATE_KEY;
const BBB_LIST_ID = process.env.KLAVIYO_LIST_ID;        // BBB
const ADS_LIST_ID = process.env.KLAVIYO_LIST_ID_ADS;    // Ads
const REVISION = '2024-10-15';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': PROD_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: 'ok' };
  if (event.httpMethod !== 'POST')   return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    if (!KLAVIYO_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing env: KLAVIYO_PRIVATE_KEY' }) };

    const body = JSON.parse(event.body || '{}');

    const name         = (body.name || '').trim();
    const email        = (body.email || '').trim().toLowerCase();
    const phone        = (body.phone || '').trim();
    const businessType = (body.businessType || '').trim();
    const primary_need = (body.primary_need || '').trim(); // from /book form

    if (!email || (!businessType && !primary_need)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    const LIST_ID = primary_need ? ADS_LIST_ID : BBB_LIST_ID;
    if (!LIST_ID) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing env: LIST_ID (check KLAVIYO_LIST_ID[_ADS])' }) };

    // ---- helpers ----
    function toE164(usOrRaw) {
      if (!usOrRaw) return null;
      const digits = String(usOrRaw).replace(/\D+/g,'');
      if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
      if (digits.length === 10) return `+1${digits}`;
      if (String(usOrRaw).startsWith('+') && digits.length > 8) return usOrRaw;
      return null;
    }
    const phone_e164 = toE164(phone);

    // Split full name into first/last
    let [first_name, ...rest] = (name || '').split(/\s+/).filter(Boolean);
    const last_name = rest.join(' ');

    const baseHeaders = {
      Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`,
      'Content-Type': 'application/json',
      revision: REVISION
    };

    const profileAttrs = {
      email,
      phone_number: phone_e164,
      first_name,
      last_name,
      properties: {
        phone_raw: phone || null,
        businessType: businessType || null,
        primary_need: primary_need || null,
        $source: primary_need ? 'Freelance Ad Form' : 'Build Better Blueprint Form'
      }
    };

    const makeProfilePayload = () => ({
      data: { type: 'profile', attributes: profileAttrs }
    });

    // ---------- 1) Create or find profile ----------
    let profileId = null;

    const pRes = await fetch('https://a.klaviyo.com/api/profiles/', {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify(makeProfilePayload())
    });

    let pText = await pRes.text();
    let pJson; try { pJson = JSON.parse(pText); } catch {}

    if (pRes.ok && pJson?.data?.id) {
      profileId = pJson.data.id;
    } else {
      // Fallback: fetch by email (handles already-existing profile)
      const fRes = await fetch(
        'https://a.klaviyo.com/api/profiles/?' +
          new URLSearchParams({ filter: `equals(email,"${email.replace(/"/g, '\\"')}")` }),
        { headers: { Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`, revision: REVISION } }
      );

      const fText = await fRes.text();
      let fJson; try { fJson = JSON.parse(fText); } catch {}

      if (fRes.ok && fJson?.data?.[0]?.id) {
        profileId = fJson.data[0].id;
      } else {
        // surface error from create/find
        return { statusCode: 502, headers, body: JSON.stringify({ error: 'Profile upsert failed', details: pText || fText }) };
      }
    }

    // ---------- 2) Normalize/update profile (fixes "first last last") ----------
    const upRes = await fetch(`https://a.klaviyo.com/api/profiles/${profileId}/`, {
      method: 'PATCH',
      headers: baseHeaders,
      body: JSON.stringify({
        data: {
          type: 'profile',
          id: profileId,
          attributes: profileAttrs
        }
      })
    });

    if (!upRes.ok) {
      const upText = await upRes.text();
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Profile update failed', details: upText }) };
    }

    // ---------- 3) Subscribe to list ----------
    const sRes = await fetch(`https://a.klaviyo.com/api/lists/${LIST_ID}/relationships/profiles/`, {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify({ data: [{ type: 'profile', id: profileId }] })
    });

    if (!sRes.ok) {
      const sText = await sRes.text();
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'List subscribe failed', details: sText }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error('Server error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error' }) };
  }
};
