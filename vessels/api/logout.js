import { clearSessionCookie, securityHeaders } from '../lib/auth.js';

export default function handler(req, res) {
  securityHeaders(res);
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.setHeader('Location', '/');
  return res.status(303).end();
}
