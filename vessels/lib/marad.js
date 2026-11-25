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
