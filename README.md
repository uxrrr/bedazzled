# Jewelry Appraisal Catalog

A private, single-tenant catalog for a jewelry appraisal collection: passwordless
login, an item grid with photos and notes, and a one-click encrypted backup.
Read-only by design — item data is managed by editing and running a seed
script, not through the website.

## Stack

- **Backend**: Netlify Functions (TypeScript), no framework.
- **Storage**: [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/) —
  every item's data and every photo is encrypted at rest (AES-256-GCM).
- **Auth**: Netlify Identity, accessed directly via `gotrue-js` (not the
  `netlify-identity-widget` package). Login is passwordless: signing in
  emails a one-time link.
- **Frontend**: plain HTML + ES modules, no build step, no framework. Styled
  with [Pico CSS](https://picocss.com/) plus a custom theme.

## Why read-only

There is no "add item," edit, or photo-upload UI or backend endpoint. All
data changes (new items, notes, photos) are made locally by editing and
running `scripts/seed.ts`, which writes directly to the production Blobs
store. This keeps the deployed site's attack surface small and avoids
building out a full editing UI for a single-user catalog.

## Local development

Requires the [Netlify CLI](https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/).

```bash
npm install
netlify link      # link this checkout to the Netlify site
netlify dev        # runs the Functions + static site locally
```

Type-check the TypeScript (Functions, `lib/`, and `scripts/`) with:

```bash
npx tsc --noEmit
```

There is no bundler and no test suite — the frontend in `public/` is plain
JavaScript loaded directly by the browser.

## Environment variables

Copy `.env.example` to `.env` for local scripts, and set these in the
Netlify dashboard (Site configuration > Environment variables, scoped to
**Functions**) for the deployed site — variables in `netlify.toml` are
*not* visible to Functions at runtime, only during the build.

| Variable | Purpose |
| --- | --- |
| `PHOTO_ENC_KEY` | 32 random bytes, base64-encoded. Encrypts every item and photo at rest. **Losing this key permanently loses all data — keep a second copy somewhere safe** (a password manager or with the physical appraisal paperwork). |
| `NETLIFY_SITE_ID` | The site's ID. Required by every Function (Blobs is authenticated explicitly rather than relying on automatic context detection) and by `scripts/seed.ts`. |
| `NETLIFY_BLOBS_TOKEN` | A Netlify Personal Access Token (User settings > Applications) with Blobs access. Same requirement as above. |
| `BLOBS_STORE_PREFIX` | Netlify Blobs stores are namespaced by name only, not by deploy context, so a preview deploy would otherwise read/write the exact same data as production. Set to `production` for the live site; set to a distinct nonempty prefix like `test-` for local dev, deploy previews, and branch deploys. |

Generate `PHOTO_ENC_KEY` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Managing item data

```bash
npm run seed
```

Runs `scripts/seed.ts`, which writes items and photos directly to the
**production** Blobs store (it hardcodes real store names and ignores
`BLOBS_STORE_PREFIX`). Edit that script to add, change, or re-import items.

## Deployment

Continuous deployment from GitHub is configured in Netlify — pushes to
`main` build and deploy automatically. See `CLAUDE.md` for hard-won notes on
Netlify/GitHub configuration quirks (env var scoping, Blobs authentication,
private-repo build restrictions) if a deploy doesn't behave as expected.

## Project layout

```
netlify/functions/   Read-only API: list/get items, fetch photos, download-everything backup
lib/                 Shared server-side code: auth, Blobs storage, encryption, item versioning
public/              Frontend: item grid, item detail page, login page, shared theme
scripts/seed.ts      The only way item data is created or edited
docs/                Archived design notes and point-in-time debugging logs
```

See `CLAUDE.md` for a deeper architecture walkthrough.
