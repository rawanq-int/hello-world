// Fetches vessel positions from Marad and reduces them to name + location only.
// Marad's exact response format isn't public, so this reads the common field names.

const NAME_KEYS = ['name', 'vesselName', 'vessel_name', 'shipName', 'ship_name', 'title'];
const IMO_KEYS = ['imo', 'imoNumber', 'imo_number', 'IMO'];
const LAT_KEYS = ['lat', 'latitude', 'Latitude', 'LAT'];
const LON_KEYS = ['lon', 'lng', 'long', 'longitude', 'Longitude', 'LON'];
const TIME_KEYS = ['timestamp', 'positionTime', 'position_time', 'lastUpdate', 'last_update', 'updatedAt', 'updated_at', 'time', 'reportedAt'];
const NESTED_POSITION_KEYS = ['position', 'location', 'lastPosition', 'last_position', 'coordinates', 'geo'];
const LIST_KEYS = ['vessels', 'data', 'items', 'results', 'records', 'fleet', 'value'];

function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  return undefined;
}

function findList(body) {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    for (const k of LIST_KEYS) {
      if (Array.isArray(body[k])) return body[k];
      if (body[k] && typeof body[k] === 'object') {
        const inner = findList(body[k]);
        if (inner) return inner;
      }
    }
  }
  return null;
}

function toNumber(v) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function normalize(item) {
  let lat = toNumber(pick(item, LAT_KEYS));
  let lon = toNumber(pick(item, LON_KEYS));
  let time = pick(item, TIME_KEYS);
  if (lat === null || lon === null) {
    const pos = pick(item, NESTED_POSITION_KEYS);
    if (Array.isArray(pos) && pos.length >= 2) {
      // GeoJSON order is [lon, lat]
      lon = toNumber(pos[0]);
      lat = toNumber(pos[1]);
    } else if (pos && typeof pos === 'object') {
      if (Array.isArray(pos.coordinates) && pos.coordinates.length >= 2) {
        lon = toNumber(pos.coordinates[0]);
        lat = toNumber(pos.coordinates[1]);
      } else {
        lat = toNumber(pick(pos, LAT_KEYS));
        lon = toNumber(pick(pos, LON_KEYS));
      }
      time = time ?? pick(pos, TIME_KEYS);
    }
  }
  const valid = lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  return {
    name: String(pick(item, NAME_KEYS) ?? 'Unnamed vessel'),
    imo: pick(item, IMO_KEYS) != null ? String(pick(item, IMO_KEYS)) : null,
    lat: valid ? lat : null,
    lon: valid ? lon : null,
    updated: time != null ? String(time) : null,
  };
}

export function maradConfigured() {
  return Boolean(process.env.MARAD_API_KEY && process.env.MARAD_VESSELS_URL);
}

export async function fetchVesselLocations() {
  const url = process.env.MARAD_VESSELS_URL;
  const key = process.env.MARAD_API_KEY;
  const headerName = process.env.MARAD_AUTH_HEADER || 'Authorization';
  const headerValue = headerName.toLowerCase() === 'authorization'
    ? `${process.env.MARAD_AUTH_SCHEME ?? 'Bearer'} ${key}`.trim()
    : key;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res;
  try {
    res = await fetch(url, {
      headers: { [headerName]: headerValue, Accept: 'application/json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const err = new Error(`Marad responded with HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const body = await res.json();
  const list = findList(body);
  if (!list) {
    const fields = body && typeof body === 'object' ? Object.keys(body).slice(0, 20) : [];
    const err = new Error('Could not find a list of vessels in Marad\'s response');
    err.fields = fields; // field names only, never values
    throw err;
  }

  const vessels = list.map(normalize);
  const withPosition = vessels.filter((v) => v.lat !== null);
  const sampleFields = list[0] && typeof list[0] === 'object' ? Object.keys(list[0]).slice(0, 30) : [];
  return { vessels, withPosition: withPosition.length, sampleFields };
}
