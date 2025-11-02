const ok = {
  'Access-Control-Allow-Origin': 'https://drayishere.com',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

const KLAVIYO_KEY = process.env.KLAVIYO_PRIVATE_KEY; // set in Netlify
const LIST_ID     = process.env.KLAVIYO_LIST_ID;     // Uy6iGS
const REVISION    = '2023-12-15';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: ok, body: 'ok' };
  if (event.httpMethod !== 'POST')   return { statusCode: 405, headers: ok, body: JSON.stringify({ error:'Method not allowed' }) };

  try {
    const { name, email, businessType } = JSON.parse(event.body || '{}');
    if (!email || !businessType) return { statusCode: 400, headers: ok, body: JSON.stringify({ error:'Missing email or businessType' }) };

    console.log('CREATE PROFILE →', email, businessType);
    const pRes = await fetch('https://a.klaviyo.com/api/profiles/', {
      method:'POST',
      headers:{ Authorization:`Klaviyo-API-Key ${KLAVIYO_KEY}`, 'Content-Type':'application/json', revision:REVISION },
      body: JSON.stringify({ data:{ type:'profile', attributes:{ email, first_name:name || undefined, properties:{ businessType, $source:'drayishere.com' } } } })
    });
    const pJson = await pRes.json();
    console.log('PROFILE RESP →', pRes.status, JSON.stringify(pJson));
    if (!pRes.ok || !pJson?.data?.id) return { statusCode: 502, headers: ok, body: JSON.stringify({ error:'Create/Update
