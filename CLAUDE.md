# Rules for this repo

- Root site (Vercel project `hello-world`): static, everything lives in `index.html`. No frameworks or build step unless asked.
- `vessels/` is a separate Vercel project (`vessel-locations`, root directory `vessels/`): password-protected Marad vessel locations. Serverless functions in `vessels/api/`, shared code in `vessels/lib/`. See `vessels/README.md` for its environment variables.
- Never put API keys or secrets in this repo. Keys belong in Vercel environment variables, used only from server-side code.
- Work on a branch and open a pull request for changes after the initial setup.
