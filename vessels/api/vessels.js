import { getSession, securityHeaders } from '../lib/auth.js';
import { fetchVesselLocations, maradConfigured } from '../lib/marad.js';

export default async function handler(req, res) {
  securityHeaders(res);
  if (!getSession(req)) {
    return res.status(401).json({ error: 'Not signed in' });
  }
  if (!maradConfigured()) {
    return res.status(503).json({
      error: 'Marad is not set up yet. Add MARAD_API_KEY in Vercel, then redeploy.',
    });
  }
  try {
    const { vessels } = await fetchVesselLocations();
    return res.status(200).json({ vessels, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return res.status(502).json({ error: err.message, fieldsSeen: err.fields });
  }
}
