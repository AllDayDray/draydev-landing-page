// netlify/functions/klaviyo-subscribe-freelance.js
// Freelance endpoint — uses single Klaviyo key, handles duplicates, and subscribes to the Freelance Ads list.

const KLAVIYO_KEY = process.env.KLAVIYO_PRIVATE_KEY;            // <- your single Klaviyo private API key (pk_...)
const LIST_ID     = safeStr(process.env.KLAVIYO_LIST_ID_FREELANCE); // <- your Freelance Ads List ID (e.g. U3nRjC)
const REVISION    = '2024-10-15';                               // Klaviyo API revision header

function safeStr(v) {
  return (v && String(v).trim()) || '';
}

function makeCors(originHeader) {
  const origin =
    (originHeader && /^https:\/\/.+/i.test(originHeader))
      ? originHeader
      : 'https://drayishere.com';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    'Content-Type': 'application/json'
  };
}

function normalizeUSPhone(raw) {
  if (!raw) return undefined;
  const d = String(raw).replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  return undefined;
}

function inferSuppressed(attrs = {}) {
  const sub = attrs.subscriptions || {};
  const s = String(
    sub.email?.marketing?.state || sub.email?.marketing?.status || sub.email?.status || ''
  ).toLowerCase();
  return ['suppressed', 'unsubscribed', 'blocked', 'bounced'].includes(s);
}

function parseBody(event) {
  const headers = event.headers || {};
  const ct = (headers['content-type'] || headers['Content-Type'] || '').toLowerCase();
  if (ct.includes('application/json')) {
    try { return JSON.parse(event.body || '{}'); } catch { return {}; }
  }
  if (ct.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(event.body || ''));
  }
  // Fallback: try JSON, else empty
  try { return JSON.parse(event.body || '{}'); } catch { return {}; }
}

exports.handler = async (event) => {
  const cors = makeCors(event.headers?.origin || event.headers?.Origin);

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: 'ok' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
  }

  try {
    if (!KLAVIYO_KEY) {
      return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: 'KLAVIYO_PRIVATE_KEY not set' }) };
    }
    if (!LIST_ID) {
      return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: 'KLAVIYO_LIST_ID_FREELANCE not set' }) };
    }

    const bodyObj     = parseBody(event);
    const name        = safeStr(bodyObj.name);
    const email       = safeStr(bodyObj.email || bodyObj.email_address).toLowerCase();
    const primaryNeed = safeStr(bodyObj.primary_need || bodyObj.primaryNeed);
    const phone       = normalizeUSPhone(bodyObj.phone);

    if (!email) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false, error: 'Missing email' }) };
    }

    // --- 1) Create or update profile ---
    let profileId;
    const createRes = await fetch('https://a.klaviyo.com/api/profiles/', {
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

            subscriptions: {
            email: {
              marketing: {
                consent: "SUBSCRIBED"
              }
            }
          },

            subscriptions: {
              email: {
                marketing: {
                  consent: "SUBSCRIBED"
                }
              }
            },

            properties: {
              ...(primaryNeed ? { primaryNeed } : {}),
              source: 'Freelance Ad Form'
            }
          }
        }
      })
    });

    if (createRes.ok) {
      const j = await createRes.json();
      profileId = j?.data?.id;
    } else if (createRes.status === 409) {
      // Duplicate — try to extract the duplicate ID from error first
      const j = await createRes.json().catch(() => ({}));
      profileId = j?.errors?.[0]?.meta?.duplicate_profile_id;

      // Fallback: look up by email within THIS account/key
      if (!profileId) {
        const filter = encodeURIComponent(`equals(email,"${email}")`);
        const lookup = await fetch(`https://a.klaviyo.com/api/profiles?filter=${filter}`, {
          headers: {
            Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`,
            Accept: 'application/json',
            revision: REVISION
          }
        });
        const lj = await lookup.json().catch(() => ({}));
        profileId = lj?.data?.[0]?.id;
      }

      if (!profileId) {
        return { statusCode: 409, headers: cors, body: JSON.stringify({ ok: false, error: 'Duplicate profile, no ID found in this account' }) };
      }

      // Patch any new attributes
      await fetch(`https://a.klaviyo.com/api/profiles/${profileId}/`, {
        method: 'PATCH',
        headers: {
          Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`,
          Accept: 'application/json',
          revision: '2024-10-15',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          data: {
            type: 'profile',
            id: profileId,
            attributes: {
              first_name: name || undefined,
              phone_number: phone || undefined,
              properties: {
                ...(primaryNeed ? { primaryNeed } : {}),
                source: 'Freelance Ad Form'
              }
            }
          }
        })
      }).catch(() => {});
    } else {
      const j = await createRes.json().catch(() => ({}));
      return { statusCode: createRes.status, headers: cors, body: JSON.stringify({ ok: false, error: 'Profile create/update failed', details: j }) };
    }

    // --- 2) Optional: suppression check ---
    try {
      const getRes = await fetch(`https://a.klaviyo.com/api/profiles/${profileId}/?additional-fields[profile]=subscriptions`, {
        headers: {
          Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`,
          Accept: 'application/json',
          revision: REVISION
        }
      });
      if (getRes.ok) {
        const g = await getRes.json();
        if (inferSuppressed(g?.data?.attributes || {})) {
          return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: false, reason: 'suppressed', profile: profileId }) };
        }
      }
    } catch (e) {
      // non-fatal; continue to list subscribe
    }

    // --- 3) Subscribe to the Freelance Ads list (triggers flow) ---
    const addRes = await fetch(`https://a.klaviyo.com/api/lists/${LIST_ID}/relationships/profiles/`, {
      method: 'POST',
      headers: {
        Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`,
        Accept: 'application/json',
        revision: REVISION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ data: [{ type: 'profile', id: String(profileId) }] })
    });

    if (!addRes.ok) {
      const t = await addRes.text().catch(() => '');
      return { statusCode: addRes.status, headers: cors, body: JSON.stringify({ ok: false, error: 'Add to list failed', details: t }) };
    }

    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, list: LIST_ID, profile: profileId, subscribed: true }) };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: 'Server error', details: String(err && err.message || err) }) };
  }
};
