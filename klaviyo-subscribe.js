// BBB unified endpoint — creates/updates profile, handles duplicates, adds to BBB list, suppression check

const KLAVIYO_KEY       = process.env.KLAVIYO_PRIVATE_KEY; // BBB account private key
const LIST_ID_BBB       = process.env.KLAVIYO_LIST_ID_BBB || process.env.KLAVIYO_LIST_ID; // BBB list
const LIST_ID_FREELANCE = process.env.KLAVIYO_LIST_ID_FREELANCE; // not used for BBB calls; kept for back-compat if payload marks freelance
const REVISION          = '2024-10-15';

const cors = {
  'Access-Control-Allow-Origin': 'https://drayishere.com',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

function looksLikeFreelance(body, headers) {
  const flag = (body.list || '').toLowerCase();
  if (flag === 'freelance') return true;
  if (body.primary_need)   return true;
  const ref = headers?.referer || headers?.Referer || '';
  return /\/book\/?$/i.test(ref);
}
function pickListId(body, headers) {
  return looksLikeFreelance(body, headers) ? LIST_ID_FREELANCE : LIST_ID_BBB;
}
function canonBT(v) {
  const raw = String(v || '').trim().toLowerCase();
  if (!raw) return '';
  const map = new Map([
    ['local service provider','Local Service Provider'],['local service providers','Local Service Provider'],
    ['health & wellness','Health & Wellness'],['health and wellness','Health & Wellness'],
    ['independent professional','Independent Professional'],['independent professionals','Independent Professional'],['independent pro','Independent Professional'],
    ['restaurant & food','Restaurant & Food'],['restaurant/food','Restaurant & Food'],['restaurants','Restaurant & Food'],['restaurant','Restaurant & Food'],
    ['beauty & cosmetics','Beauty & Cosmetics'],['beauty/cosmetics','Beauty & Cosmetics'],['beauty','Beauty & Cosmetics'],
    ['retail & e-commerce','Retail & E-Commerce'],['retail/e-commerce','Retail & E-Commerce'],['retail & ecommerce','Retail & E-Commerce'],
    ['ecommerce','Retail & E-Commerce'],['e-commerce','Retail & E-Commerce'],['retail','Retail & E-Commerce']
  ]);
  return map.get(raw) || v;
}
function buildProperties(body, headers) {
  const props = {};
  if (looksLikeFreelance(body, headers)) {
    if (body.primary_need) props.primaryNeed = String(body.primary_need).trim();
    props.source = 'Freelance Ad Form';
  } else {
    const bt = canonBT(body.businessType || body.business_type);
    if (bt) { props.businessType = bt; props.business_type = bt; }
    props.source = 'Build Better  Blueprint Form';
  }
  return props;
}
function inferSuppressed(attrs = {}) {
  const sub = attrs.subscriptions || {};
  const s = String(
    sub.email?.marketing?.state || sub.email?.marketing?.status || sub.email?.status || ''
  ).toLowerCase();
  return ['suppressed','unsubscribed','blocked','bounced'].includes(s);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: 'ok' };
  if (event.httpMethod !== 'POST')   return { statusCode: 405, headers: cors, body: JSON.stringify({ ok:false, error: 'Method not allowed' }) };

  try {
    const body  = JSON.parse(event.body || '{}');
    const name  = (body.name  || '').trim();
    const email = (body.email || '').trim().toLowerCase();
    let   phone = (body.phone || '').trim();

    if (!email)  return { statusCode: 400, headers: cors, body: JSON.stringify({ ok:false, error: 'Missing email' }) };

    if (phone) {
      const digits = String(phone).replace(/\D/g, '');
      phone = digits ? (digits.length === 11 && digits.startsWith('1') ? `+${digits}` : (digits.length === 10 ? `+1${digits}` : undefined)) : undefined;
    }

    const LIST_ID = pickListId(body, event.headers);
    if (!LIST_ID) return { statusCode: 500, headers: cors, body: JSON.stringify({ ok:false, error: 'List not configured' }) };

    const properties = buildProperties(body, event.headers);

    // Create/Update profile; accept duplicate_profile
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

    let profileId = null;
    if (createRes.ok) {
      const j = await createRes.json();
      profileId = j?.data?.id;
    } else if (createRes.status === 409) {
      const j = await createRes.json();
      profileId = j?.errors?.[0]?.meta?.duplicate_profile_id;
      if (!profileId) {
        // fallback lookup
        const lookup = await fetch(`https://a.klaviyo.com/api/profiles?filter=equals(email,'${email}')`, {
          headers: { Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`, Accept:'application/json', revision: REVISION }
        });
        const lj = await lookup.json();
        profileId = lj?.data?.[0]?.id;
      }
      if (profileId) {
        await fetch(`https://a.klaviyo.com/api/profiles/${profileId}/`, {
          method:'PATCH',
          headers: { Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`, Accept:'application/json', revision: REVISION, 'Content-Type':'application/json' },
          body: JSON.stringify({ data:{ type:'profile', id:profileId, attributes:{ first_name: name || undefined, phone_number: phone || undefined, properties }}})
        }).catch(()=>{});
      } else {
        return { statusCode: 409, headers: cors, body: JSON.stringify({ ok:false, error:'Duplicate profile, no ID found', details: j }) };
      }
    } else {
      const j = await createRes.json().catch(()=> ({}));
      return { statusCode: createRes.status, headers: cors, body: JSON.stringify({ ok:false, error:'Profile update failed', details: j }) };
    }

    // Suppression check
    try {
      const getRes = await fetch(`https://a.klaviyo.com/api/profiles/${profileId}/?additional-fields[profile]=subscriptions`, {
        headers: { Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`, Accept:'application/json', revision: REVISION }
      });
      if (getRes.ok) {
        const g = await getRes.json();
        if (['suppressed','unsubscribed','blocked','bounced'].includes(
          String(g?.data?.attributes?.subscriptions?.email?.marketing?.state || '').toLowerCase()
        )) {
          return { statusCode: 200, headers: cors, body: JSON.stringify({ ok:false, reason:'suppressed', profile: profileId, list: LIST_ID }) };
        }
      }
    } catch {}

    // Add to BBB list (triggers flow)
    const addRes = await fetch(`https://a.klaviyo.com/api/lists/${LIST_ID}/relationships/profiles/`, {
      method: 'POST',
      headers: { Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`, Accept:'application/json', revision: REVISION, 'Content-Type':'application/json' },
      body: JSON.stringify({ data:[{ type:'profile', id: profileId }] })
    });
    if (!addRes.ok) {
      const t = await addRes.text();
      return { statusCode: addRes.status, headers: cors, body: JSON.stringify({ ok:false, error:'Add to list failed', details:t }) };
    }

    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok:true, list: LIST_ID, profile: profileId, subscribed:true }) };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok:false, error:'Server error', details: err.message }) };
  }
};
