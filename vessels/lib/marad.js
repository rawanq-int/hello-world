// Marad API client: vessel list + per-vessel location data.
// Docs: https://external.marad.ms/ (Marad Generic API). Auth: header "ApiKey: <key>".
//   GET /api/vessels/getVessels                  -> [{ number, name }]
//   GET /api/LocationData?vesselName=<name>      -> [{ name, value, isFromTemplate }]

const DEFAULT_BASE_URL = 'https://external.marad.ms';
const CONCURRENCY = 5;
const TIMEOUT_MS = 15000;

export function maradConfigured() {
  return Boolean(process.env.MARAD_API_KEY);
}

function baseUrl() {
  return (process.env.MARAD_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

async function maradGet(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(baseUrl() + path, {
      headers: {
        [process.env.MARAD_AUTH_HEADER || 'ApiKey']: process.env.MARAD_API_KEY,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = new Error(`Marad responded with HTTP ${res.status} for ${path.split('?')[0]}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Marad took too long to respond for ${path.split('?')[0]}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Parse "64.15", "-21.94", "64°08.5'N", "64 08 30 N", "S 4° 37.2'" into decimal degrees.
export function parseCoordinate(raw, kind) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  let val = Number(s.replace(',', '.'));
  if (!Number.isFinite(val)) {
    const hemi = (s.match(/[NSEW]/i) || [''])[0].toUpperCase();
    const nums = (s.replace(/(\d),(\d)/g, '$1.$2').match(/\d+(?:\.\d+)?/g) || []).map(Number);
    if (!nums.length) return null;
    val = nums[0] + (nums[1] || 0) / 60 + (nums[2] || 0) / 3600;
    if (hemi === 'S' || hemi === 'W' || /^-/.test(s)) val = -val;
  }
  if (kind === 'lat' && Math.abs(val) > 90) return null;
  if (kind === 'lon' && Math.abs(val) > 180) return null;
  return val;
}

function extractPosition(entries) {
  let lat = null;
  let lon = null;
  for (const e of entries) {
    const label = (e.name || '').toLowerCase();
    if (lat === null && /\blat/.test(label)) lat = parseCoordinate(e.value, 'lat');
    if (lon === null && /\b(lon|lng|long)/.test(label)) lon = parseCoordinate(e.value, 'lon');
  }
  if (lat === null || lon === null) {
    // A single "position"/"coordinates" entry like "64.15, -21.94" or "64°08'N 21°56'W"
    const combined = entries.find((e) => /(position|coordinat|gps)/i.test(e.name || '') && e.value);
    if (combined) {
      const parts = String(combined.value).split(/[,;/]|\s{2,}|(?<=[NSns])\s+/).filter(Boolean);
      if (parts.length >= 2) {
        lat = parseCoordinate(parts[0], 'lat');
        lon = parseCoordinate(parts[1], 'lon');
      }
    }
  }
  return lat !== null && lon !== null ? { lat, lon } : { lat: null, lon: null };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

// Calls each relevant Marad endpoint once and reports only status, item count and
// field names (never values), to see what this API key can reach.
export async function probeEndpoints() {
  const results = [];
  const describe = (body) => {
    if (Array.isArray(body)) {
      const first = body.find((x) => x && typeof x === 'object');
      return { count: body.length, fields: first ? Object.keys(first).slice(0, 25) : [] };
    }
    if (body && typeof body === 'object') return { count: null, fields: Object.keys(body).slice(0, 25) };
    return { count: null, fields: [] };
  };
  const meaning = (status) =>
    status === 200 ? 'works' :
    status === 401 || status === 403 ? 'no access with this key' :
    status === 404 ? 'not found' :
    status === 400 ? 'reachable, but needs different parameters' :
    `HTTP ${status}`;

  async function probe(label, path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(baseUrl() + path, {
        headers: { [process.env.MARAD_AUTH_HEADER || 'ApiKey']: process.env.MARAD_API_KEY, Accept: 'application/json' },
        signal: controller.signal,
      });
      let info = { count: null, fields: [] };
      if (res.ok) { try { info = describe(await res.json()); } catch { /* not JSON */ } }
      const r = { endpoint: label, status: res.status, result: meaning(res.status), ...info };
      results.push(r);
      return res.ok ? r : null;
    } catch (err) {
      const reason = err.name === 'AbortError' ? 'timed out'
        : (err.cause?.code || err.cause?.errors?.[0]?.code || err.cause?.message || err.message);
      results.push({ endpoint: label, status: null, result: `could not connect (${reason})`, count: null, fields: [] });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // The vessel list gives us a real vessel name/number for the per-vessel endpoints.
  let vesselName = null;
  let vesselNumber = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(baseUrl() + '/api/vessels/getVessels', {
      headers: { [process.env.MARAD_AUTH_HEADER || 'ApiKey']: process.env.MARAD_API_KEY, Accept: 'application/json' },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (res.ok) {
      const list = await res.json();
      const v = Array.isArray(list) ? list.find((x) => x && x.name) : null;
      vesselName = v?.name ?? null;
      vesselNumber = v?.number ?? null;
    }
  } catch { /* reported by the probe below */ }

  await probe('GET /api/vessels/getVessels', '/api/vessels/getVessels');

  let locationLabels = [];
  if (vesselName) {
    const q = 'vesselName=' + encodeURIComponent(vesselName);
    const to = new Date();
    const from = new Date(to.getTime() - 90 * 24 * 3600 * 1000);
    // LocationData labels (the "name" of each pair) tell us which location fields exist.
    try {
      const res = await fetch(baseUrl() + '/api/LocationData?' + q, {
        headers: { [process.env.MARAD_AUTH_HEADER || 'ApiKey']: process.env.MARAD_API_KEY, Accept: 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) locationLabels = [...new Set(data.map((e) => e && e.name).filter(Boolean))].slice(0, 40);
      }
    } catch { /* reported by the probe below */ }
    await probe('GET /api/LocationData', '/api/LocationData?' + q);
    await probe('GET /api/Voyages/GetVoyages (last 90 days)', `/api/Voyages/GetVoyages?${q}&startDate=${from.toISOString()}&endDate=${to.toISOString()}`);
    await probe('GET /api/Certificates', '/api/Certificates?' + q);
    await probe('GET /api/Components/GetVesselComponents', '/api/Components/GetVesselComponents?' + q);
    await probe('GET /api/ComponentOperations', '/api/ComponentOperations?' + q);
    await probe('GET /api/Parts/GetPartsPerVessel', '/api/Parts/GetPartsPerVessel?' + q);
    await probe('GET /api/users/getusersonvessel/{vesselName}', '/api/users/getusersonvessel/' + encodeURIComponent(vesselName));
    await probe('GET /api/Budgets/GetBudgets', `/api/Budgets/GetBudgets?year=${to.getFullYear()}&${q}`);
    await probe('GET /api/Cashbook', '/api/Cashbook?' + q);
    if (vesselNumber) await probe('GET /api/Checklist', '/api/Checklist?vesselNumber=' + encodeURIComponent(vesselNumber));
  }

  return { baseUrl: baseUrl(), testedWithAVessel: Boolean(vesselName), locationLabels, results };
}

export async function fetchVesselLocations() {
  const list = await maradGet('/api/vessels/getVessels');
  if (!Array.isArray(list)) {
    const err = new Error('Marad\'s vessel list was not in the expected format');
    err.fields = list && typeof list === 'object' ? Object.keys(list).slice(0, 20) : [];
    throw err;
  }

  const vessels = await mapLimit(list, CONCURRENCY, async (v) => {
    const name = v?.name ?? 'Unnamed vessel';
    const number = v?.number ?? null;
    try {
      const data = await maradGet('/api/LocationData?vesselName=' + encodeURIComponent(name));
      const entries = (Array.isArray(data) ? data : [])
        .filter((e) => e && e.name && e.value != null && String(e.value).trim() !== '')
        .map((e) => ({ label: String(e.name), value: String(e.value) }));
      const { lat, lon } = extractPosition(entries.map((e) => ({ name: e.label, value: e.value })));
      return { name, number, location: entries, lat, lon, error: null };
    } catch (err) {
      return { name, number, location: [], lat: null, lon: null, error: err.message };
    }
  });

  vessels.sort((a, b) => a.name.localeCompare(b.name));
  return { vessels };
}
