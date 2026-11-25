# Vessel locations

Password-protected page that lists vessel positions from Marad. Deployed as its own Vercel project with root directory `vessels/`.

Nothing is public: every page is served by `api/page.js`, which shows the sign-in form until you're signed in. Vessel data comes only from `api/vessels.js`, which checks the session and calls Marad on the server, so the Marad key never reaches the browser.

## Environment variables (set in Vercel, type Secret)

| Name | What it is |
|---|---|
| `MARAD_API_KEY` | API key from Marad (sent in the `ApiKey` header) |
| `MARAD_BASE_URL` | Optional. Marad API address. Default `https://external.marad.ms` |
| `MARAD_AUTH_HEADER` | Optional. Header name for the key. Default `ApiKey` |

The site calls `GET /api/vessels/getVessels`, then `GET /api/LocationData?vesselName=…` for each vessel (5 at a time), and shows the returned name/value pairs. If latitude/longitude can be read from them, a map link is added.
| `SITE_USERNAME` | Sign-in username |
| `SITE_PASSWORD` | Sign-in password (use a long one) |
| `SESSION_SECRET` | Random string, 32+ characters, used to sign the session cookie |

Changes to environment variables apply on the next deploy.
