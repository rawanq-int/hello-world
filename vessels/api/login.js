import { checkCredentials, createSessionCookie, securityHeaders } from '../lib/auth.js';

export default async function handler(req, res) {
  securityHeaders(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  const body = typeof req.body === 'object' && req.body ? req.body : Object.fromEntries(new URLSearchParams(req.body || ''));
  const { username, password } = body;

  if (checkCredentials(username, password)) {
    res.setHeader('Set-Cookie', createSessionCookie(username));
    res.setHeader('Location', '/');
    return res.status(303).end();
  }

  // Slow down repeated guessing.
  await new Promise((r) => setTimeout(r, 1200));
  res.setHeader('Location', '/?error=1');
  return res.status(303).end();
}
