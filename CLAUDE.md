# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A private, single-tenant jewelry appraisal catalog: Netlify Functions (TypeScript) backed by Netlify Blobs for data/photo storage, Netlify Identity (via `gotrue-js` directly, not the `netlify-identity-widget` package) for passwordless magic-link login, and a plain HTML/ES-modules frontend with no build step or framework.

The site is **read-only by design** — there is no "add item," edit, or photo-upload UI or backend endpoint. All data changes (new items, notes, photos) are made by editing/running `scripts/seed.ts`, which writes directly to the production Blobs store, bypassing the Functions layer entirely.

## Commands

There is no bundler, linter, or test suite configured — `package.json` only defines one script.

- **Run locally**: `netlify dev` (Netlify CLI; not a package.json script). Requires `netlify link`ing to the site first, or a local `.env` per `.env.example`.
- **Type-check**: `npx tsc --noEmit` (compiles `netlify/functions`, `lib`, and `scripts` per `tsconfig.json`; the frontend in `public/` is plain JS/ES modules, not type-checked).
- **Seed/write data**: `npm run seed` (runs `scripts/seed.ts` via `ts-node`). This is the only way item data is created or edited — see "Read-only by design" above. Requires `NETLIFY_SITE_ID`, `NETLIFY_BLOBS_TOKEN`, and `PHOTO_ENC_KEY` in a local `.env` (see `.env.example`); it always targets the **production** Blobs store regardless of `BLOBS_STORE_PREFIX`, since it hardcodes real store names.
- **Deploy**: push to `main` on GitHub (continuous deployment via Netlify). See the GitHub/Netlify section below before assuming a push will actually build.

## Architecture

**Auth**: Netlify Identity, accessed two different ways on purpose:
- Client-side (`public/identity.js`): imports `gotrue-js` directly from a CDN, not the `netlify-identity-widget` package (removed — its DOM overlay/iframe was unreliable). Login is passwordless: `login.html` calls `requestPasswordRecovery()` and repurposes GoTrue's password-recovery email as a "magic sign-in link"; no password is ever set or shown to the user (a random one is generated internally only for invite acceptance, which requires some password value at the API level).
- Server-side (`lib/auth.ts`): every Netlify Function must use the **v1 handler signature** (`(event, context) => ...`), because that's the only signature where Netlify reliably attaches the already-verified Identity user to `context.clientContext.user` — this is documented as unreliable under the v2 Request/Response signature. `withAuth()` wraps every function handler to enforce the auth check and turn thrown errors into clean JSON responses (with the real `Error.message`, not a generic one, since these responses only ever reach an already-authenticated user) instead of repeating that boilerplate per function.

**Data layer** (`lib/stores.ts`, `lib/versioned-item-store.ts`):
- Three Netlify Blobs stores: items, photos, audit log (`itemsStore()`/`photosStore()`/`auditStore()`).
- Blobs stores are namespaced by name only, **not** by deploy context — a preview deploy's store is the exact same data as production's. `BLOBS_STORE_PREFIX` (an env var, fails closed if unset) prefixes store names to keep preview/branch/test data isolated from production.
- `getStore()` is called with explicit `{ name, siteID, token }` rather than relying on Netlify's automatic Blobs context detection, which wasn't working reliably in this project's deploy setup (see the GitHub/Netlify section for why, and the exact call-shape gotcha that cost real debugging time).
- `loadItem()` reads an item plus an optimistic-concurrency version number from blob metadata. This existed to support in-place edits from the site UI; since the site is now read-only, it's currently only exercised by `items-get.ts`.

**Encryption** (`lib/crypto.ts`): every item's JSON and every photo blob is encrypted at rest with AES-256-GCM, keyed by the `PHOTO_ENC_KEY` env var (32 random bytes, base64), with the blob's own ID used as AAD so ciphertexts can't be swapped between records even with raw Blobs read access. Losing this key means permanently losing all data — there is no recovery path, hence the "keep a second copy" warning in `.env.example`.

**Netlify Functions** (`netlify/functions/`, all read-only): `items-list.ts`, `items-get.ts`, `photos-get.ts` (auth-gated photo fetch — `<img>` tags can't carry an auth header, so the frontend fetches photos through this and converts to an object URL), and `download-everything.ts` (zips every decrypted item + photo as a one-click backup; capped by the ~6MB Netlify Functions response limit, noted inline as needing a background-function rework if the collection grows).

**Frontend** (`public/`): no framework, no bundler — plain HTML with `<script type="module">` and hand-written DOM manipulation.
- `index.html` — item grid.
- `items.html` — item detail: photo carousel (prev/next flanking the frame, thumbnail strip, PhotoSwipe lightbox on click) and notes, view-only.
- `login.html` — passwordless sign-in, with a persisted (via `localStorage`, survives reload) client-side cooldown to avoid tripping GoTrue's per-email rate limit.
- `app.js` / `identity.js` — shared helpers (`apiFetch`, photo object-URL fetching, GoTrue wrapper).
- `theme.css` — shared visual theme layered on Pico CSS: flat, monochrome, auction-catalog-style design (modeled on Christie's lot listings) — no card shadows/borders/radius, uncropped photos on a light frame, serif uppercase titles, small gray uppercase "eyebrow" labels, flat bordered buttons.

**docs/**: `netlify-identity-migration.md` is an archived design doc from evaluating a full `@netlify/identity` migration (decided against — see its own notes on why passwordless was kept instead). `deploy-status-*.md` files are point-in-time debugging logs from real production incidents; useful history, not living documentation.

## Working with GitHub + Netlify on this project

Lessons from a real debugging session where every one of these bit us, in
order. Check these before assuming a config change "should just work" —
verify against actual docs/source, don't iterate by guessing.

### Netlify env vars: scope matters, and `netlify.toml` is not universal

- Variables declared in `netlify.toml` (including under
  `[context.<name>.environment]`) are **only available during the build**.
  They are **never visible to serverless Functions at runtime**, no matter
  how correctly scoped/nested. Anything a Function reads via
  `process.env` — including per-context values like a Blobs store prefix —
  must be set through the Netlify UI/CLI/API instead, with its scope
  explicitly including **Functions**.
- The correct `netlify.toml` context syntax is `[context.production.environment]`
  directly. There is no `[context.<name>.functions."*"]` sub-table for env
  vars — that's not part of Netlify's schema and fails silently (no error,
  just never applies).
- A UUID-shaped (or otherwise high-entropy) non-secret value — like a site
  ID — can trip Netlify's build-time secrets scanner. Fix with
  `SECRETS_SCAN_OMIT_KEYS = "VAR_NAME"` in `netlify.toml`, scoped to just
  that key, rather than disabling the scan.

### Netlify Blobs

- Automatic `siteID`/`token` detection is documented to work inside
  Functions/Edge Functions/Build Plugins without any manual config. If you
  still get `MissingBlobsEnvironmentError` / "The environment has not been
  configured to use Netlify Blobs" in production despite that, don't
  assume the docs are wrong — check whether an *upstream* env var (like a
  store-name prefix your own code needs) actually reached the function
  first, since a `netlify.toml`-scoping mistake can look identical to a
  Blobs auth failure.
- If manual config is genuinely needed: `getStore()` takes **exactly one
  argument** — either a plain string, or a single options object with a
  `name` property inside it (e.g. `getStore({ name, siteID, token })`).
  There is **no** `getStore(name, options)` two-argument form — passing one
  compiles fine in JS (extra args are silently ignored) and produces the
  exact same opaque "not configured" error, wasting a full debugging cycle
  before you notice the call shape itself was wrong. When in doubt, pull
  the actual package (`npm pack @netlify/blobs@<version>` and read
  `dist/main.js`/`dist/main.d.ts`) rather than trust a remembered API
  shape or a plausible-looking guess.
- Only use real, documented env var names for credentials
  (`NETLIFY_BLOBS_TOKEN` = a genuine Personal Access Token from User
  settings > Applications, `NETLIFY_SITE_ID` = the site's actual ID).
  Never invent a variable name like `NETLIFY_FUNCTIONS_TOKEN` that sounds
  plausible but isn't real — it'll just be `undefined` and fail
  silently/confusingly.

### GitHub + Netlify continuous deployment

- A site created via `netlify deploy` from the CLI may never have had
  continuous deployment configured. Check Site configuration > Build &
  deploy > Continuous deployment to confirm a repo/branch is actually
  linked before assuming pushes will trigger builds.
- **Private repos**: Netlify's lower plan tiers restrict builds to a single
  "verified" Git contributor. A push from any other identity (e.g. an
  agent/bot committing as a different name/email than the account's linked
  GitHub identity) is silently **build-blocked**, not just flagged — the
  push succeeds, the deploy just never happens. If a stream of pushes stop
  producing new live deploys with no visible error on the git side, check
  the Netlify Deploys tab directly for "Build blocked: Unrecognized Git
  contributor" before assuming the code itself is broken.
  - Fix options: make the repo public (removes the restriction entirely —
    safe only if nothing sensitive is actually tracked in git; check
    `.gitignore` coverage and `git log -p` on any `.env`-like files
    first), upgrade to a plan tier with unlimited contributors, or link the
    pushing identity under Team settings > Git contributors (note: that
    page only lets *you* link your own account — it's not a way to
    whitelist a second contributor on restrictive plans).
- After any Netlify env var change: **redeploys don't happen
  automatically**. Either trigger one manually from the Deploys tab or
  push a new commit.
- Verify which deploy is actually live (commit hash + timestamp in the
  Deploys tab) before trusting that a code fix is in production — a
  failed/blocked build one commit back can leave stale code live
  indefinitely with no obvious symptom other than "the fix didn't work."

### General principle

When a fix doesn't work and the error looks identical to before, don't
iterate on variations of the same theory. Stop and verify the actual
mechanism directly — read the library's real source/types, fetch the
platform's real docs, or check the actual dashboard state — instead of
guessing plausible-sounding env var names or config shapes.
