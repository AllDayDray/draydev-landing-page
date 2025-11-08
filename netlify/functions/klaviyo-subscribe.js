// Unified Klaviyo integration for BBB + Freelance (final)
// - Uses global fetch (no node-fetch)
// - Routes to correct list
// - Sets EMAIL consent via Subscriptions API (so flows can send)

const KLAVIYO_KEY = process.env.KLAVIYO_PRIVATE_KEY;
const LIST_ID_BBB = process.env.KLAVIYO_LIST_ID_BBB || process.env.KLAVIYO_LIST_ID;
const LIST_ID_FREELANCE = process.env.KLAVIYO_LIST_ID_FREELANCE;
const REVISION = '2023-12-15';

const cors = {
  'Access-Control-Allow-Origin': 'https://drayishere.com',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

// Decide which list based on payload or referer
function looksLikeFreelance(body, headers) {
  const flag = (body.list || '').toLowerCase();
  if (flag === 'freelance') return true;
  if (body.primary_need) return true;
  const ref = headers?.referer || headers?.Referer || '';
  return /\/book\/?$/i.test(ref);
}
function pickListId(body, headers) {
  return looksLikeFreelance(body, headers) ? LIST_ID_FREELANCE : LIST_ID_BBB;
}

// Build profile properties for each page
function buildProperties(body, headers) {
  const props = {};
  if (looksLikeFreelance(body, headers)) {
    if (body.primary_need) props.primaryNeed = String(body.primary_need).trim();
    props.source = 'Freelance Ad Form';
  } else {
    if (body.businessType) {
      // Write both keys for compatibility with segments/flows
      props.businessType = String(body.businessType).trim();
      props.business_type = props.businessType;
    }
    props.source = 'Build Better Blueprint Form';
  }
  return props;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: 'ok' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const name  = (body.name  || '').trim();
    const email = (body.email || '').trim();
    let   phone = (body.phone || '').trim();

    if (!email) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Missing email' }) };
    }

    // E.164 (US) phone if provided (non-blocking)
    if (phone) {
      const digits = phone.replace(/\D/g, '');
      phone = digits ? `+1${digits}` : undefined;
    }

    const LIST_ID = pickListId(body, event.headers);
    if (!LIST_ID) {
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'List not configured' }) };
    }

    const properties = buildProperties(body, event.headers);

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
            properties
          }
        }
      })
    });

    const profileJson = await profileRes.json();
    if (!profileRes.ok) {
      return { statusCode: profileRes.status, headers: cors, body: JSON.stringify({ error: 'Profile update failed', details: profileJson }) };
    }

    // Subscribe to list (sets EMAIL consent so welcome flows can send)
    const subRes = await fetch('https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs/', {
      method: 'POST',
      headers: {
        Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`,
        Accept: 'application/json',
        revision: REVISION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        data: {
          type: 'profile-subscription-bulk-create-job',
          attributes: {
            list_id: LIST_ID,
            custom_source: 'drayishere.com',
            subscriptions: [
              {
                channels: ['EMAIL'],
                profile: { data: { type: 'profile', id: profileJson.data.id } }
              }
            ]
          }
        }
      })
    });

    if (!subRes.ok) {
      const t = await subRes.text();
      return { statusCode: subRes.status, headers: cors, body: JSON.stringify({ error: 'Subscription failed', details: t }) };
    }

    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, list: LIST_ID, profile: profileJson.data.id }) };

  } catch (err) {
    console.error('Function error:', err);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Server error', details: err.message }) };
  }
};
