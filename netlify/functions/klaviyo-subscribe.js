// BBB endpoint — create/update profile, add to BBB list, trigger flow via list join
const KLAVIYO_KEY = process.env.KLAVIYO_PRIVATE_KEY;                // same private key (pk_...)
const LIST_ID     = process.env.KLAVIYO_LIST_ID_BBB || process.env.KLAVIYO_LIST_ID; // BBB list id
const REVISION    = '2024-10-15';

function cors(originHeader) {
  const origin = (originHeader && originHeader.startsWith('https://'))
    ? originHeader
    : 'https://drayishere.com';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS'
  };
}

function isSuppressed(attrs = {}) {
  const s = String(
    attrs?.subscriptions?.email?.marketing?.state ||
    attrs?.subscriptions?.email?.marketing?.status ||
    attrs?.email?.status || ''
  ).toLowerCase();
  return ['suppressed','unsubscribed','blocked','bounced'].includes(s);
}

exports.handler = async (event) => {
  const headers = cors(event.headers?.origin || event.headers?.Origin);

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: 'ok' };
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, headers, body: JSON.stringify({ ok:false, error:'Method not allowed' }) };

  try {
    if (!KLAVIYO_KEY) return { statusCode: 500, headers, body: JSON.stringify({ ok:false, error:'KLAVIYO_PRIVATE_KEY not set' }) };
    if (!LIST_ID)     return { statusCode: 500, headers, body: JSON.stringify({ ok:false, error:'KLAVIYO_LIST_ID_BBB (or KLAVIYO_LIST_ID) not set' }) };

    const body  = JSON.parse(event.body || '{}');
    const name  = (body.name || '').trim();
    const email = (body.email || '').trim().toLowerCase();
    let   phone = (body.phone || '').trim();
    const bt    = (body.businessType || body.business_type || '').trim();

    if (!email) return { statusCode: 400, headers, body: JSON.stringify({ ok:false, error:'Missing email' }) };

    if (phone) {
      const d = phone.replace(/\D/g, '');
      phone = d ? (d.length === 11 && d.startsWith('1') ? `+${d}` : (d.length === 10 ? `+1${d}` : undefined)) : undefined;
    }

    const properties = { ...(bt ? { businessType: bt, business_type: bt } : {}), source: 'Build Better Blueprint Form' };

    // 1) create/update profile
    const createRes = await fetch('https://a.klaviyo.com/api/profiles/', {
      method: 'POST',
      headers: {
        Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`,
        Accept: 'application/json',
        revision: REVISION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        data: { type:'profile', attributes: { email, first_name: name || undefined, phone_number: phone || undefined, properties } }
      })
    });

    let profileId;
    if (createRes.ok) {
      const j = await createRes.json();
      profileId = j?.data?.id;
    } else if (createRes.status === 409) {
      const j = await createRes.json().catch(()=>({}));
      profileId = j?.errors?.[0]?.meta?.duplicate_profile_id;
      if (!profileId) {
        const filter = encodeURIComponent(`equals(email,'${email}')`);
        const lookup = await fetch(`https://a.klaviyo.com/api/profiles?filter=${filter}`, {
          headers: { Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`, Accept: 'application/json', revision: REVISION }
        });
        const lj = await lookup.json().catch(()=>({}));
        profileId = lj?.data?.[0]?.id;
      }
      if (!profileId) {
        return { statusCode: 409, headers, body: JSON.stringify({ ok:false, error:'Duplicate profile, no ID found' }) };
      }
      // best-effort patch
      await fetch(`https://a.klaviyo.com/api/profiles/${profileId}/`, {
        method: 'PATCH',
        headers: { Authorization:`Klaviyo-API-Key ${KLAVIYO_KEY}`, Accept:'application/json', revision:REVISION, 'Content-Type':'application/json' },
        body: JSON.stringify({ data:{ type:'profile', id:profileId, attributes:{ first_name: name || undefined, phone_number: phone || undefined, properties }}})
      }).catch(()=>{});
    } else {
      const j = await createRes.json().catch(()=> ({}));
      return { statusCode: createRes.status, headers, body: JSON.stringify({ ok:false, error:'Profile create failed', details: j }) };
    }

    // 2) suppression check
    try {
      const getRes = await fetch(`https://a.klaviyo.com/api/profiles/${profileId}/?additional-fields[profile]=subscriptions`, {
        headers: { Authorization:`Klaviyo-API-Key ${KLAVIYO_KEY}`, Accept:'application/json', revision: REVISION }
      });
      if (getRes.ok) {
        const g = await getRes.json();
        if (isSuppressed(g?.data?.attributes || {})) {
          return { statusCode: 200, headers, body: JSON.stringify({ ok:false, reason:'suppressed', profile: profileId, list: LIST_ID }) };
        }
      }
    } catch {}

    // 3) add to BBB list (triggers flow)
    const addRes = await fetch(`https://a.klaviyo.com/api/lists/${LIST_ID}/relationships/profiles/`, {
      method: 'POST',
      headers: {
        Authorization:`Klaviyo-API-Key ${KLAVIYO_KEY}`,
        Accept:'application/json',
        revision: REVISION,
        'Content-Type':'application/json'
      },
      body: JSON.stringify({ data:[{ type:'profile', id: profileId }] })
    });

    if (!addRes.ok) {
      const t = await addRes.text();
      return { statusCode: addRes.status, headers, body: JSON.stringify({ ok:false, error:'Add to list failed', details: t }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok:true, list: LIST_ID, profile: profileId, subscribed:true }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok:false, error:'Server error', details: err.message }) };
  }
};
