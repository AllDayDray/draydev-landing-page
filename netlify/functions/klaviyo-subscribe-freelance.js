// netlify/functions/klaviyo-subscribe-freelance.js
// Freelance endpoint — uses one Klaviyo key, handles duplicates, adds to Freelance list

const KLAVIYO_KEY = process.env.KLAVIYO_PRIVATE_KEY;           // single key for your account
const LIST_ID     = prob(process.env.KLAVIYO_LIST_ID_FREELANCE);
const REVISION    = '2024-10-15';

function prob(v){ return (v && String(v).trim()) || ''; }

function makeCors(originHeader) {
  const origin =
    (originHeader && originHeader.startsWith('https://')) ? originHeader : 'https://drayishere.com';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
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
  return ['suppressed','unsubscribed','blocked','bounced'].includes(s);
}

exports.handler = async (event) => {
  const cors = makeCors(event.headers?.origin || event.headers?.Origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: 'ok' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ ok:false, error:'Method not allowed' }) };
  }

  try {
    if (!KLAVIYO_KEY) {
      return { statusCode: 500, headers: cors, body: JSON.stringify({ ok:false, error:'KLAVIYO_PRIVATE_KEY not set' }) };
    }
    if (!LIST_ID) {
      return { statusCode: 500, headers: cors, body: JSON.stringify({ ok:false, error:'KLAVIYO_LIST_ID_FREELANCE not set' }) };
    }

    const body        = JSON.parse(event.body || '{}');
    const name        = (body.name || '').trim();
    const email       = (body.email || '').trim().toLowerCase();
    const primaryNeed = (body.primary_need || '').trim();
    const phone       = normalizeUSPhone(body.phone);

    if (!email) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ ok:false, error:'Missing email' }) };
    }

    // 1) Create or update profile
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
      // Duplicate — fetch the existing profile in THIS account
      const filter = encodeURIComponent(`equals(email,'${email}')`);
      const lookup = await fetch(`https://a.klaviyo.com/api/profiles?filter=${filter}`, {
        headers: { Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`, Accept:'application/json', revision: REVISION }
      });
      const lj = await lookup.json().catch(() => ({}));
      profileId = lj?.data?.[0]?.id;

      if (!profileId) {
        const j = await createRes.json().catch(() => ({}));
        profileId = j?.errors?.[0]?.meta?.duplicate_profile_id;
      }
      if (!profileId) {
        return { statusCode: 409, headers: cors, body: JSON.stringify({ ok:false, error:'Duplicate profile, no ID found in this account' }) };
      }

      // Patch any new attrs
      await fetch(`https://a.klaviyo.com/api/profiles/${profileId}/`, {
        method: 'PATCH',
        headers: {
          Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`,
          Accept: 'application/json',
          revision: REVISION,
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
      return { statusCode: createRes.status, headers: cors, body: JSON.stringify({ ok:false, error:'Profile create/update failed', details: j }) };
    }

    // 2) Optional: suppression check
    try {
      const getRes = await fetch(`https://a.klaviyo.com/api/profiles/${profileId}/?additional-fields[profile]=subscriptions`, {
        headers: { Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`, Accept:'application/json', revision: REVISION }
      });
      if (getRes.ok) {
        const g = await getRes.json();
        if (inferSuppressed(g?.data?.attributes || {})) {
          return { statusCode: 200, headers: cors, body: JSON.stringify({ ok:false, reason:'suppressed', profile: profileId }) };
        }
      }
    } catch (e) {
      // ignore suppression lookup failures
    }

    // 3) Add to Freelance list (triggers flow)
    const addRes = await fetch(`https://a.klaviyo.com/api/lists/${LIST_ID}/relationships/profiles/`, {
      method: 'POST',
      headers: {
        Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`,
        Accept: 'application/json',
        revision: REVISION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ data: [{ type: 'profile', id: profileId }] })
    });

    if (!addRes.ok) {
      const t = await addRes.text().catch(() => '');
      return { statusCode: addRes.status, headers: cors, body: JSON.stringify({ ok:false, error:'Add to list failed', details: t }) };
    }

    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok:true, list: LIST_ID, profile: profileId, subscribed:true }) };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok:false, error:'Server error', details: err.message }) };
  }
};
