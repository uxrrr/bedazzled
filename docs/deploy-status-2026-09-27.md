# Deploy status as of 2026-09-27

Session paused here at the user's request. This is a snapshot of exactly
where things stand so a future session doesn't have to re-diagnose from
scratch.

## App code: believed complete

The jewelry appraisal app itself (passwordless login, item CRUD, photo
encryption, storage isolation) has been functionally done since commit
`288c8a4`. Everything since then has been infrastructure/deploy debugging,
not app logic changes.

## Root causes found and fixed, in the order they were hit

1. **`BLOBS_STORE_PREFIX` unset in production** — `lib/stores.ts` fails
   closed if this isn't set, by design (prevents preview/test data from
   landing in the production Blobs store). Fixed by setting it in
   `netlify.toml` under `[context.production.environment]`.

2. **Wrong TOML shape for that fix** — an earlier attempt nested the env
   var under a nonexistent `[context.production.functions."*"]` table.
   Netlify's real schema is `[context.<context>.environment]` directly.
   This silently no-op'd the "fix" above for several commits.

3. **Netlify's private-repo Git-contributor limit** — the plan in use only
   allows builds from one recognized Git contributor per private repo.
   Commits pushed by Claude sessions (`Claude <noreply@anthropic.com>`)
   were rejected as an unrecognized contributor, even though the code was
   correct — every push from `f405311` onward silently failed to deploy
   until this was noticed. **Fixed by making the repo public** (confirmed
   safe: no secrets or user data are tracked in git — `.env` is
   gitignored, `.env.example` only has empty placeholders, Blobs/photo
   data lives entirely in Netlify Blobs, not the repo).

4. **`items-list` crash on any server error** — `index.html`'s `load()`
   assumed the response was always a JSON array, so a server error came
   back as an uncaught `TypeError: items is not iterable` in the browser
   console instead of a readable message. Fixed to check `res.ok` first
   and show the actual error text on the page.

5. **Generic 400 errors** — `withAuth` in `lib/auth.ts` used to flatten
   every server error to "Invalid request". Now it surfaces the real
   `Error.message` (safe here since these responses only ever reach an
   already-authenticated user).

6. **Netlify Blobs auto-detection not working** — `getStore()` was
   throwing "The environment has not been configured to use Netlify
   Blobs" even with `BLOBS_STORE_PREFIX` correctly set and the deploy
   succeeding. An earlier attempt to fix this by passing `siteID`/`token`
   explicitly used a nonexistent `NETLIFY_FUNCTIONS_TOKEN` env var, so it
   silently fell through to the same broken auto-detection and looked
   like it hadn't helped (that's why it got reverted). Real fix: `lib/
   stores.ts` now explicitly passes `{ siteID, token }` to `getStore()`,
   reusing the `NETLIFY_SITE_ID` / `NETLIFY_BLOBS_TOKEN` pair that
   `scripts/seed.ts` already relied on for off-platform access.
   - `NETLIFY_SITE_ID` (not sensitive) is inlined in `netlify.toml`.
   - `NETLIFY_BLOBS_TOKEN` (a real Netlify Personal Access Token, from
     User settings > Applications) was added by the user as a
     Production-scoped secret env var in the Netlify dashboard.

7. **Secrets-scanner false positive** — Netlify's entropy-based secrets
   scanner flagged the `NETLIFY_SITE_ID` UUID as looking like a leaked
   secret and failed the build. Fixed with `SECRETS_SCAN_OMIT_KEYS =
   "NETLIFY_SITE_ID"` in `netlify.toml`, scoped to just that one key.

## Correction (verified against Netlify's own docs, not guessed)

Items 1, 2, and 6 above were built on a wrong premise: **environment
variables declared in `netlify.toml` are never available to serverless
Functions at runtime — only during the build.** For a variable to be
readable via `process.env` inside a Function, its scope must include
"Functions," and that can only be set through the Netlify UI, CLI, or API,
never the config file. This is stated directly in Netlify's docs
(`docs.netlify.com/build/functions/environment-variables/`) and confirmed
by multiple Netlify support-forum threads hitting the exact same mistake.

So `[context.production.environment]` in `netlify.toml` was **never** going
to make `BLOBS_STORE_PREFIX` or `NETLIFY_SITE_ID` visible to
`lib/stores.ts`, regardless of the TOML syntax being correct. Both have
been removed from `netlify.toml` (commit after `614412b`). They must
instead be added as real environment variables in the Netlify dashboard
(Site configuration > Environment variables), the same way
`NETLIFY_BLOBS_TOKEN` already was:

- `BLOBS_STORE_PREFIX` = `production`, scoped to include Functions (and
  ideally scoped to the Production deploy context specifically, using the
  UI's "different value per deploy context" option, so Previews/branch
  deploys don't silently share it).
- `NETLIFY_SITE_ID` = `cdb3dfb5-c8e2-44ce-9f8b-1ca931c4dc1d`, scoped to
  include Functions. Not sensitive, so no need for `SECRETS_SCAN_OMIT_KEYS`
  once it's out of `netlify.toml`.

Per Netlify's own docs, automatic Blobs `siteID`/`token` detection *should*
work unmodified inside Functions/Edge Functions/Build Plugins — the
"environment has not been configured" error may fully disappear once
`BLOBS_STORE_PREFIX` is set correctly via the UI (since that's what was
actually missing, not necessarily Blobs auto-detection itself). The manual
`getStoreOptions()` override in `lib/stores.ts` is a safe fallback either
way, but automatic detection is worth re-testing (remove the manual
override) once the UI-set env vars are confirmed working, rather than
assuming both fixes were independently necessary.

## Where it was left off (open/unconfirmed)

Commit `bb52cb9` (the secrets-scanner fix) was the last push. **It was
never confirmed whether this deploy actually succeeded or whether login +
item list finally works end to end** — the session has no network access
to check the live site directly (`bedazzled-appraisal.netlify.app` isn't
on this container's outbound allowlist), and the user stopped before
reporting back.

## First steps for whoever picks this back up

1. Check the Netlify Deploys tab: did `bb52cb9` publish successfully?
2. If yes: log in, see if the item list actually loads now. This closes
   out the original bug report ("item list doesn't load after login").
3. If it still fails: get the exact new error text (the app now surfaces
   real error messages instead of generic ones, so whatever shows up
   should be diagnosable directly rather than guessed at).
4. Known non-blocking loose end from `docs/netlify-identity-migration.md`:
   the sign-in email is Netlify's stock "reset your password" template
   from `no-reply@netlify.com`, which reads confusingly for a passwordless
   flow. Since the user upgraded their Netlify plan, custom email
   templates/sender may now be available — worth revisiting if desired.
