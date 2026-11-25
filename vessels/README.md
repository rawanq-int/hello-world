# Vessel locations

Password-protected page that lists vessel positions from Marad. Deployed as its own Vercel project with root directory `vessels/`.

Nothing is public: every page is served by `api/page.js`, which shows the sign-in form until you're signed in. Vessel data comes only from `api/vessels.js`, which checks the session and calls Marad on the server, so the Marad key never reaches the browser.

## Environment variables (set in Vercel, type Secret)

| Name | What it is |
|---|---|
| `MARAD_API_KEY` | API key from Marad |
| `MARAD_VESSELS_URL` | Full URL of the Marad endpoint that returns vessels with positions |
| `MARAD_AUTH_HEADER` | Optional. Header Marad expects the key in. Default `Authorization` (sent as `Bearer <key>`). Use e.g. `x-api-key` to send the key as-is |
| `MARAD_AUTH_SCHEME` | Optional. Prefix when the header is `Authorization`. Default `Bearer` |
| `SITE_USERNAME` | Sign-in username |
| `SITE_PASSWORD` | Sign-in password (use a long one) |
| `SESSION_SECRET` | Random string, 32+ characters, used to sign the session cookie |

Changes to environment variables apply on the next deploy.
