# Working with GitHub + Netlify on this project

Lessons from a real debugging session where every one of these bit us, in
order. Check these before assuming a config change "should just work" —
verify against actual docs/source, don't iterate by guessing.

## Netlify env vars: scope matters, and `netlify.toml` is not universal

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

## Netlify Blobs

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

## GitHub + Netlify continuous deployment

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

## General principle

When a fix doesn't work and the error looks identical to before, don't
iterate on variations of the same theory. Stop and verify the actual
mechanism directly — read the library's real source/types, fetch the
platform's real docs, or check the actual dashboard state — instead of
guessing plausible-sounding env var names or config shapes.
