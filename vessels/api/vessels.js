import { getSession, securityHeaders } from '../lib/auth.js';
import { fetchVesselLocations, maradConfigured } from '../lib/marad.js';

export default async function handler(req, res) {
  securityHeaders(res);
  if (!getSession(req)) {
    return res.status(401).json({ error: 'Not signed in' });
  }
  if (!maradConfigured()) {
    return res.status(503).json({
      error: 'Marad is not set up yet. Add MARAD_API_KEY and MARAD_VESSELS_URL in Vercel, then redeploy.',
    });
  }
  try {
    const { vessels, withPosition, sampleFields } = await fetchVesselLocations();
    const payload = { vessels, fetchedAt: new Date().toISOString() };
    if (vessels.length > 0 && withPosition === 0) {
      payload.warning = 'Marad returned vessels, but no positions were recognised.';
      payload.fieldsSeen = sampleFields; // names only, to help map the format
    }
    return res.status(200).json(payload);
  } catch (err) {
    return res.status(502).json({
      error: err.name === 'AbortError' ? 'Marad took too long to respond.' : err.message,
      fieldsSeen: err.fields,
    });
  }
}
