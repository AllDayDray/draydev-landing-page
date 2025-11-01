// netlify/functions/klaviyo-subscribe.js
// Uses Klaviyo's NEW JSON:API endpoints (v2023+)

const ok = {
  'Access-Control-Allow-Origin': 'https://drayishere.com',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

const KLAVIYO_KEY = process.env.KLAVIYO_PRIVATE_KEY; // e.g. pk_...
const LIST_ID = process.env.KLAVIYO_LIST_ID;         // your "Build Better Blueprint Leads" list id
const REVISION = '2023-12-15';                       // Klaviyo API revision header

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

    // 1) Create or update the profile
    const createProfileRes = await fetch('https://a.klaviyo.com/api/profiles/', {
      method: 'POST',
      headers: {
        'Authorization': `Klaviyo-API-Key ${KLAVIYO_KEY}`,
        'Content-Type': 'application/json',
        'revision': REVISION
      },
      body: JSON.stringify({
        data: {
          type: 'profile',
          attributes: {
            email,
            first_name: name || undefined,
            properties: { businessType, $source: 'drayishere.com' }
          }
        }
      })
    });

    const profileData = await createProfileRes.json();
    if (!createProfileRes.ok || !profileData?.data?.id) {
      return {
        statusCode: 502,
        headers: ok,
        body: JSON.stringify({ error: 'Create/Update profile failed', details: profileData })
      };
    }

    const profileId = profileData.data.id;

    // 2) Add profile to the list (this triggers your "Joins List" flow)
    const addToListRes = await fetch(`https://a.klaviyo.com/api/lists/${LIST_ID}/relationships/profiles/`, {
      method: 'POST',
      headers: {
        'Authorization': `Klaviyo-API-Key ${KLAVIYO_KEY}`,
        'Content-Type': 'application/json',
        'revision': REVISION
      },
      body: JSON.stringify({
        data: [{ type: 'profile', id: profileId }]
      })
    });

    const addToListJson = await addToListRes.json().catch(() => ({}));
    if (!addToListRes.ok) {
      return {
        statusCode: 502,
        headers: ok,
        body: JSON.stringify({ error: 'Add to list failed', details: addToListJson })
      };
    }

    return { statusCode: 200, headers: ok, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, headers: ok, body: JSON.stringify({ error: 'Server error' }) };
  }
};
