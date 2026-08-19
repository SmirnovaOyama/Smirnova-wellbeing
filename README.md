# Wellbeing

A private daily check-in tracker (mood, and other self-reported metrics), built as a React + TypeScript SPA on Cloudflare Pages, with Pages Functions as the API and D1 as the database.

- `/` — public, read-only view of today's status and history. No login required.
- `/admin` — private dashboard. Log in to check in, edit notes, and delete entries.

## Stack

- Frontend: Vite + React + TypeScript
- Backend: Cloudflare Pages Functions (`functions/api/*`)
- Database: Cloudflare D1
- Images: Cloudflare R2, served back through `/api/uploads/*`
- Auth: a single admin password (PBKDF2-hashed), stateless HMAC-signed session cookie

## Notes

A note accepts a small subset of Markdown: `![alt](url)` images, `[text](url)` links,
`**bold**`, `*italic*` and `` `code` ``. It is rendered as React elements rather than
HTML, and only `http(s)` and same-origin URLs are followed, so a `javascript:` or
`data:` URL in a note stays inert text.

Paste an image straight into the note box (⌘V) and it is uploaded to R2 and inserted
as Markdown at the caret. Dropping a file works the same way, and **Add image** opens
the picker — which is the path phones can actually reach, and on iOS also offers the
camera. PNG, JPEG, GIF, WebP and AVIF up to 5 MB; SVG is deliberately refused, since
it can carry script.

Uploaded images are readable by anyone who has the URL — the same as the notes they
sit in, which the public homepage already shows. Keys are random UUIDs, so nothing is
enumerable.

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

R2 is simulated locally by wrangler, so image uploads work in dev with no setup. The
bucket only has to exist for a deploy — see below.

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
   Create the image bucket, whose name must match `wrangler.toml`:
   ```bash
   npx wrangler r2 bucket create wellbeing-images
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
