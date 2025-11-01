// v3-ping
const ok = {
  'Access-Control-Allow-Origin': 'https://drayishere.com',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: ok, body: 'ok' };
  }
  // Immediately return without calling Klaviyo
  return { statusCode: 200, headers: ok, body: JSON.stringify({ ok: true, ping: 'v3-check' }) };
};
