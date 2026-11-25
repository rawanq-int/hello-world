// Runs during the Vercel build: checks which Marad endpoints the API key can reach.
// Prints only status codes, item counts and field names. Never prints data or the key.
// Never fails the build.
import { probeEndpoints, maradConfigured } from '../lib/marad.js';

try {
  if (!maradConfigured()) {
    console.log('[marad-probe] MARAD_API_KEY not available in this build; skipping.');
  } else {
    const report = await probeEndpoints();
    console.log(`[marad-probe] Base URL: ${report.baseUrl}`);
    for (const r of report.results) {
      const count = r.count != null ? ` | items: ${r.count}` : '';
      const fields = r.fields.length ? ` | fields: ${r.fields.join(', ')}` : '';
      console.log(`[marad-probe] ${r.endpoint} -> ${r.status ?? '-'} ${r.result}${count}${fields}`);
    }
    if (report.locationLabels.length) {
      console.log(`[marad-probe] LocationData labels: ${report.locationLabels.join(', ')}`);
    }
    if (!report.testedWithAVessel) {
      console.log('[marad-probe] Could not get a vessel from getVessels, so per-vessel endpoints were not tested.');
    }
  }
} catch (err) {
  console.log('[marad-probe] Probe failed: ' + err.message);
}
