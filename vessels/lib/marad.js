// Marad API client: vessel list + per-vessel location data.
// Docs: https://external.marad.ms/ (Marad Generic API). Auth: header "ApiKey: <key>".
//   GET /api/vessels/getVessels                  -> [{ number, name }]
//   GET /api/LocationData?vesselName=<name>      -> [{ name, value, isFromTemplate }]

const DEFAULT_BASE_URL = 'https://deckoffice.marad.ms/ExternalApi'; // Rawanq's Marad (DeckOffice)
const CONCURRENCY = 1; // Marad rate-limits; calls are also spaced by MIN_GAP_MS
const TIMEOUT_MS = 15000;

export function maradConfigured() {
  return Boolean(process.env.MARAD_API_KEY);
}

function baseUrl() {
  return (process.env.MARAD_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

const MIN_GAP_MS = Number(process.env.MARAD_MIN_GAP_MS || 400);
let lastCallAt = 0;
export const rateLimitInfo = {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One Marad request: spaced at least MIN_GAP_MS apart, retried on HTTP 429.
async function maradFetch(path, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    const wait = lastCallAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(baseUrl() + path, {
        headers: {
          [process.env.MARAD_AUTH_HEADER || 'ApiKey']: process.env.MARAD_API_KEY,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    for (const [k, v] of res.headers) {
      if (/^(retry-after|x-rate-?limit|ratelimit)/i.test(k)) rateLimitInfo[k] = v;
    }
    if (res.status !== 429 || attempt >= attempts) return res;
    const retryAfter = Number(res.headers.get('retry-after'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 20) * 1000 : 1500 * attempt);
  }
}

async function maradGet(path) {
  let res;
  try {
    res = await maradFetch(path);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Marad took too long to respond for ${path.split('?')[0]}`);
    throw err;
  }
  if (!res.ok) {
    const err = new Error(res.status === 429
      ? 'Marad is limiting requests right now (HTTP 429). Try Refresh in a minute.'
      : `Marad responded with HTTP ${res.status} for ${path.split('?')[0]}`);
    err.status = res.status;
    throw err;
  }
  return await res.json();
}

// Marad servers differ in field casing (name vs Name), so read fields case-insensitively.
export function field(obj, key) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (key in obj) return obj[key];
  const k = Object.keys(obj).find((x) => x.toLowerCase() === key.toLowerCase());
  return k === undefined ? undefined : obj[k];
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
    status === 429 ? 'rate limited (still after retries)' :
    `HTTP ${status}`;

  async function probe(label, path) {
    try {
      const res = await maradFetch(path);
      let body = null;
      if (res.ok) { try { body = await res.json(); } catch { /* not JSON */ } }
      results.push({ endpoint: label, status: res.status, result: meaning(res.status), ...describe(body) });
      return res.ok ? body : null;
    } catch (err) {
      const reason = err.name === 'AbortError' ? 'timed out'
        : (err.cause?.code || err.cause?.errors?.[0]?.code || err.cause?.message || err.message);
      results.push({ endpoint: label, status: null, result: `could not connect (${reason})`, count: null, fields: [] });
      return null;
    }
  }

  const list = await probe('GET /api/vessels/getVessels', '/api/vessels/getVessels');
  const v = Array.isArray(list) ? list.find((x) => field(x, 'name')) : null;
  const vesselName = v ? field(v, 'name') : null;
  const vesselNumber = v ? field(v, 'number') ?? null : null;

  let locationLabels = [];
  if (vesselName) {
    const q = 'vesselName=' + encodeURIComponent(vesselName);
    const to = new Date();
    const from = new Date(to.getTime() - 90 * 24 * 3600 * 1000);
    const loc = await probe('GET /api/LocationData', '/api/LocationData?' + q);
    // The "name" of each pair is a label (e.g. Latitude) and tells us which location fields exist.
    if (Array.isArray(loc)) locationLabels = [...new Set(loc.map((e) => field(e, 'name')).filter(Boolean))].slice(0, 40);
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

  return {
    baseUrl: baseUrl(),
    vesselCount: Array.isArray(list) ? list.length : null,
    testedWithAVessel: Boolean(vesselName),
    locationLabels,
    rateLimitHeaders: { ...rateLimitInfo },
    results,
  };
}

export async function fetchVesselLocations() {
  const list = await maradGet('/api/vessels/getVessels');
  if (!Array.isArray(list)) {
    const err = new Error('Marad\'s vessel list was not in the expected format');
    err.fields = list && typeof list === 'object' ? Object.keys(list).slice(0, 20) : [];
    throw err;
  }

  const vessels = await mapLimit(list, CONCURRENCY, async (v) => {
    const name = field(v, 'name') ?? 'Unnamed vessel';
    const number = field(v, 'number') ?? null;
    try {
      const data = await maradGet('/api/LocationData?vesselName=' + encodeURIComponent(name));
      const entries = (Array.isArray(data) ? data : [])
        .map((e) => ({ label: field(e, 'name'), value: field(e, 'value') }))
        .filter((e) => e.label && e.value != null && String(e.value).trim() !== '')
        .map((e) => ({ label: String(e.label), value: String(e.value) }));
      const { lat, lon } = extractPosition(entries.map((e) => ({ name: e.label, value: e.value })));
      return { name, number, location: entries, lat, lon, error: null };
    } catch (err) {
      return { name, number, location: [], lat: null, lon: null, error: err.message };
    }
  });

  vessels.sort((a, b) => a.name.localeCompare(b.name));
  return { vessels };
}
