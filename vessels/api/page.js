import { getSession, credentialsConfigured, securityHeaders } from '../lib/auth.js';

const STYLE = `
  :root { --bg:#f5f6f4; --panel:#fff; --ink:#18201d; --muted:#66706b; --line:#e1e5e2; --accent:#1d5a73; --accent-ink:#fff; --bad:#a3312b; }
  @media (prefers-color-scheme: dark) { :root { --bg:#121615; --panel:#1b201e; --ink:#eef2ef; --muted:#97a19c; --line:#2b322f; --accent:#6db3cf; --accent-ink:#0c1a20; --bad:#e3847d; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; background:var(--bg); color:var(--ink); font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 40px 20px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:24px; }
  h1 { font-size:1.6rem; margin:0; letter-spacing:-0.01em; }
  .muted { color:var(--muted); }
  label { display:block; font-size:.85rem; color:var(--muted); margin:14px 0 6px; }
  input { width:100%; font:inherit; color:var(--ink); background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:10px 12px; }
  button, .btn { font:inherit; font-weight:600; border-radius:8px; padding:10px 16px; cursor:pointer; border:1px solid var(--line); background:transparent; color:var(--ink); text-decoration:none; }
  button.primary { background:var(--accent); color:var(--accent-ink); border-color:var(--accent); width:100%; margin-top:20px; }
  .error { color:var(--bad); margin-top:12px; font-size:.9rem; }
  table { width:100%; border-collapse:collapse; font-size:.95rem; }
  th, td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--line); }
  th { font-size:.78rem; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); font-weight:600; }
  td.num { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; }
  a { color:var(--accent); }
  .top { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:20px; flex-wrap:wrap; }
  .actions { display:flex; gap:8px; }
`;

function loginPage({ error, notConfigured }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · Vessel locations</title><meta name="robots" content="noindex"><style>${STYLE}
  .login { max-width: 380px; margin: 10vh auto 0; }</style></head>
<body><div class="wrap"><div class="card login">
  <h1>Vessel locations</h1>
  <p class="muted">Rawanq internal. Sign in to continue.</p>
  ${notConfigured ? '<p class="error">Sign-in isn\'t set up yet. Add SITE_USERNAME, SITE_PASSWORD and SESSION_SECRET in Vercel.</p>' : ''}
  <form method="post" action="/api/login">
    <label for="u">Username</label><input id="u" name="username" autocomplete="username" required>
    <label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required>
    <button class="primary" type="submit">Sign in</button>
  </form>
  ${error ? '<p class="error">Wrong username or password.</p>' : ''}
</div></div></body></html>`;
}

function dashboardPage() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vessel locations</title><meta name="robots" content="noindex"><style>${STYLE}</style></head>
<body><div class="wrap">
  <div class="top">
    <div><h1>Vessel locations</h1><div class="muted" id="status">Loading from Marad…</div></div>
    <div class="actions">
      <button id="refresh">Refresh</button>
      <form method="post" action="/api/logout"><button type="submit">Sign out</button></form>
    </div>
  </div>
  <div class="card" style="padding:0; overflow-x:auto">
    <table>
      <thead><tr><th>Vessel</th><th>Number</th><th>Location</th><th>Map</th></tr></thead>
      <tbody id="rows"><tr><td colspan="4" class="muted">Loading…</td></tr></tbody>
    </table>
  </div>
  <p class="error" id="error" hidden></p>
</div>
<script>
  const rows = document.getElementById('rows');
  const statusEl = document.getElementById('status');
  const errorEl = document.getElementById('error');

  function cell(text, cls) {
    const td = document.createElement('td');
    if (cls) td.className = cls;
    td.textContent = text;
    return td;
  }

  async function load() {
    statusEl.textContent = 'Loading from Marad…';
    errorEl.hidden = true;
    try {
      const res = await fetch('/api/vessels', { cache: 'no-store' });
      if (res.status === 401) { location.reload(); return; }
      const data = await res.json();
      if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { fields: data.fieldsSeen });
      rows.innerHTML = '';
      if (!data.vessels.length) {
        rows.innerHTML = '<tr><td colspan="4" class="muted">Marad returned no vessels.</td></tr>';
      }
      for (const v of data.vessels) {
        const tr = document.createElement('tr');
        tr.append(cell(v.name), cell(v.number || '—', 'num'));
        const locTd = document.createElement('td');
        if (v.error) {
          locTd.textContent = 'Could not load: ' + v.error;
          locTd.className = 'error';
        } else if (!v.location.length) {
          locTd.textContent = 'No location data in Marad';
          locTd.className = 'muted';
        } else {
          for (const item of v.location) {
            const line = document.createElement('div');
            const label = document.createElement('span');
            label.className = 'muted';
            label.textContent = item.label + ': ';
            line.append(label, document.createTextNode(item.value));
            locTd.append(line);
          }
        }
        tr.append(locTd);
        const mapTd = document.createElement('td');
        if (v.lat !== null) {
          const a = document.createElement('a');
          a.href = 'https://www.openstreetmap.org/?mlat=' + v.lat + '&mlon=' + v.lon + '#map=8/' + v.lat + '/' + v.lon;
          a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'View';
          mapTd.append(a);
        } else { mapTd.textContent = '—'; }
        tr.append(mapTd);
        rows.append(tr);
      }
      statusEl.textContent = data.vessels.length + ' vessels · updated ' + new Date(data.fetchedAt).toLocaleTimeString();
    } catch (e) {
      rows.innerHTML = '<tr><td colspan="4" class="muted">No data.</td></tr>';
      statusEl.textContent = 'Could not load vessel locations';
      errorEl.textContent = e.message + (e.fields && e.fields.length ? ' Fields Marad sent: ' + e.fields.join(', ') : '');
      errorEl.hidden = false;
    }
  }
  document.getElementById('refresh').addEventListener('click', load);
  load();
</script>
</body></html>`;
}

export default function handler(req, res) {
  securityHeaders(res);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (getSessionSafe(req)) return res.status(200).send(dashboardPage());
  const url = new URL(req.url, 'http://x');
  return res.status(200).send(loginPage({ error: url.searchParams.has('error'), notConfigured: !credentialsConfigured() }));
}

function getSessionSafe(req) {
  try { return getSession(req); } catch { return null; }
}
