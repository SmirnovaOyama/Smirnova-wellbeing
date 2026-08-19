# Wellbeing

A private daily check-in tracker (mood, and other self-reported metrics), built as a React + TypeScript SPA on Cloudflare Pages, with Pages Functions as the API and D1 as the database.

- `/` — public, read-only view of today's status and history. No login required.
- `/admin` — private dashboard. Log in to check in, edit notes, and delete entries.

## Stack

- Frontend: Vite + React + TypeScript
- Backend: Cloudflare Pages Functions (`functions/api/*`)
- Database: Cloudflare D1
- Auth: a single admin password (PBKDF2-hashed), stateless HMAC-signed session cookie

## Local development

Install dependencies:

```bash
npm install
```

Set up your local secrets. Generate a password hash:

```bash
npm run hash-password -- <your-password>
```

Copy `.dev.vars.example` to `.dev.vars` and fill in the hash plus a random `SESSION_SECRET`. `.dev.vars` is gitignored — never commit it.

`SITE_OWNER` is optional. The name in the page title (`<name>'s Wellbeing`) is normally edited from the dashboard — sign in and use **Rename** in the header — and is stored in the `settings` table, so it survives a redeploy. `SITE_OWNER` only seeds a database that has no name saved yet; without either, the name falls back to `Smirnova`.

Apply the D1 schema locally:

```bash
npm run db:migrate:local
```

Run the full app (frontend + API + local D1) at `http://localhost:8788`:

```bash
npm run pages:dev
```

`npm run dev` alone starts just the Vite dev server (no API/auth/D1) for quick UI-only iteration.

## Deploying

1. Create a D1 database and put its ID in `wrangler.toml`:
   ```bash
   npx wrangler d1 create wellbeing
   ```
2. Apply the schema to the remote database:
   ```bash
   npm run db:migrate:remote
   ```
3. Set the production secrets:
   ```bash
   npx wrangler pages secret put ADMIN_PASSWORD_HASH
   npx wrangler pages secret put SESSION_SECRET
   npx wrangler pages secret put SITE_OWNER   # optional
   ```
4. Deploy:
   ```bash
   npm run deploy
   ```

## Other scripts

- `npm run lint` — oxlint
- `npm run build` — type-check + production build
- `npm run functions:typecheck` — type-check the Pages Functions
