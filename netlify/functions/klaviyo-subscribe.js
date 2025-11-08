// Unified Klaviyo integration for BBB + Freelance
// Uses global fetch (no node-fetch). CommonJS export.

const KLAVIYO_KEY = process.env.KLAVIYO_PRIVATE_KEY;

// Set BOTH of these on the drayishere.com site:
const LIST_ID_BBB = process.env.KLAVIYO_LIST_ID_BBB || process.env.KLAVIYO_LIST_ID; // BBB default/fallback
const LIST_ID_FREELANCE = process.env.KLAVIYO_LIST_ID_FREELANCE;                     // Freelance Ad List

const REVISION = '2023-12-15';

const cors = {
  'Access-Control-Allow-Origin': 'https://drayishere.com',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

// ---- routing helpers ----
function looksLikeFreelance(body, headers) {
  const flag = (body.list || '').toLowerCase();
  if (flag === 'freelance') return true;
  if (body.primary_need) return true;
  const ref = headers?.referer || headers?.Referer || '';
  return /\/book\/?$/i.test(ref);
}

function pickListId(body, headers) {
  if (looksLikeFreelance(body, headers)) return LIST_ID_FREELANCE;
  return LIST_ID_BBB;
}

// ---- property builder ----
function buildProperties(body, headers) {
  const props = { source: undefined };

  if (looksLikeFreelance(body, headers)) {
    if (body.primary_need) props.primaryNeed = String(body.primary_need).trim();
    props.source = 'Freelance Ad Form';
  } else {
    if (body.businessType) props.business_type = String(body.businessType).trim();
    props.source = 'Build Better Blueprint Form';
  }
  return props;
}

// ---- Netlify handler ----
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

    // E.164 (US)
    if (phone) phone = '+1' + phone.replace(/\D/g, '');

    const LIST_ID = pickListId(body, event.headers);
    if (!LIST_ID) {
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'List not configured' }) };
    }

    // Build profile payload with correct properties
    const properties = buildProperties(body, event.headers);

    // Create / update profile
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

   // Subscribe the profile to the list (sets EMAIL consent so flows can send)
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
            profile: {
              data: {
                type: 'profile',
                id: profileJson.data.id // the id from the create/update call above
              }
            }
          }
        ]
      }
    }
  })
});

if (!subRes.ok) {
  const t = await subRes.text();
  return {
    statusCode: subRes.status,
    headers: cors,
    body: JSON.stringify({ error: 'Subscription failed', details: t })
  };
}

return {
  statusCode: 200,
  headers: cors,
  body: JSON.stringify({ ok: true, list: LIST_ID, profile: profileJson.data.id })
};

