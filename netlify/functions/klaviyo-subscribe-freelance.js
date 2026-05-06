const KLAVIYO_KEY = process.env.KLAVIYO_PRIVATE_KEY;
const LIST_ID = safeStr(process.env.KLAVIYO_LIST_ID_FREELANCE);
const REVISION = '2024-10-15';

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

function parseBody(event) {
  const headers = event.headers || {};
  const ct = (headers['content-type'] || headers['Content-Type'] || '').toLowerCase();

  if (ct.includes('application/json')) {
    try {
      return JSON.parse(event.body || '{}');
    } catch {
      return {};
    }
  }

  if (ct.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(event.body || ''));
  }

  try {
    return JSON.parse(event.body || '{}');
  } catch {
    return {};
  }
}

exports.handler = async (event) => {
  const cors = makeCors(event.headers?.origin || event.headers?.Origin);

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: cors,
      body: 'ok'
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: cors,
      body: JSON.stringify({
        ok: false,
        error: 'Method not allowed'
      })
    };
  }

  try {
    if (!KLAVIYO_KEY) {
      return {
        statusCode: 500,
        headers: cors,
        body: JSON.stringify({
          ok: false,
          error: 'KLAVIYO_PRIVATE_KEY not set'
        })
      };
    }

    if (!LIST_ID) {
      return {
        statusCode: 500,
        headers: cors,
        body: JSON.stringify({
          ok: false,
          error: 'KLAVIYO_LIST_ID_FREELANCE not set'
        })
      };
    }

    const bodyObj = parseBody(event);

    const name = safeStr(bodyObj.name);
    const email = safeStr(
      bodyObj.email || bodyObj.email_address
    ).toLowerCase();

    const primaryNeed = safeStr(
      bodyObj.primary_need || bodyObj.primaryNeed
    );

    const phone = normalizeUSPhone(bodyObj.phone);

    if (!email) {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({
          ok: false,
          error: 'Missing email'
        })
      };
    }

    let profileId;

    // CREATE PROFILE
    const createRes = await fetch(
      'https://a.klaviyo.com/api/profiles/',
      {
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
      }
    );

    if (createRes.ok) {
      const j = await createRes.json();
      profileId = j?.data?.id;
    } else if (createRes.status === 409) {
      const j = await createRes.json().catch(() => ({}));

      profileId =
        j?.errors?.[0]?.meta?.duplicate_profile_id;

      if (!profileId) {
        const filter = encodeURIComponent(
          `equals(email,"${email}")`
        );

        const lookup = await fetch(
          `https://a.klaviyo.com/api/profiles?filter=${filter}`,
          {
            headers: {
              Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`,
              Accept: 'application/json',
              revision: REVISION
            }
          }
        );

        const lj = await lookup.json().catch(() => ({}));

        profileId = lj?.data?.[0]?.id;
      }

      if (!profileId) {
        return {
          statusCode: 409,
          headers: cors,
          body: JSON.stringify({
            ok: false,
            error: 'Duplicate profile, no ID found'
          })
        };
      }

      await fetch(
        `https://a.klaviyo.com/api/profiles/${profileId}/`,
        {
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
        }
      ).catch(() => {});
    } else {
      const j = await createRes.json().catch(() => ({}));

      return {
        statusCode: createRes.status,
        headers: cors,
        body: JSON.stringify({
          ok: false,
          error: 'Profile create/update failed',
          details: j
        })
      };
    }

    // SUBSCRIBE PROFILE + ADD TO LIST
    const subRes = await fetch(
      'https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs/',
      {
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
              custom_source: 'Website Form',
              profiles: {
                data: [
                  {
                    type: 'profile',
                    id: String(profileId)
                  }
                ]
              }
            },
            relationships: {
              list: {
                data: {
                  type: 'list',
                  id: LIST_ID
                }
              }
            }
          }
        })
      }
    );

    if (!subRes.ok) {
      const t = await subRes.text().catch(() => '');

      return {
        statusCode: subRes.status,
        headers: cors,
        body: JSON.stringify({
          ok: false,
          error: 'Subscription job failed',
          details: t
        })
      };
    }

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        ok: true,
        profile: profileId,
        subscribed: true
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({
        ok: false,
        error: 'Server error',
        details: String(err?.message || err)
      })
    };
  }
};
