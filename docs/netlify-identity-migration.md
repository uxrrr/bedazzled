# @netlify/identity migration — archived design, not implemented

> This is a complete, five-times-reviewed `@netlify/identity` + Netlify
> Functions v2 migration design, preserved for reference. **Not currently
> planned for implementation.** See "Why this isn't happening now" below
> before reviving it.

## Why this isn't happening now

The original motivation was passwordless login. That turned out to need only
a small change to the existing `gotrue-js` code (delete `user.update({
password })` after `gotrue.recover(token, true)` — that call alone already
returns a fully logged-in user; see the passwordless login work actually
shipped, in `public/login.html`/`public/index.html`). The only reason to
migrate to `@netlify/identity` at all was that Netlify's docs mark
`gotrue-js` "not recommended for new projects" — a soft, non-functional
signal, not a deprecation with a deadline. Netlify announced and then
reversed Identity's own deprecation once already (Feb 2026), and
`@netlify/identity` itself is a thin wrapper around `gotrue-js` (it lists
`gotrue-js@^1.0.1` as its own dependency) — there's no protocol-level
pressure forcing this.

**Revisit this only if**: Netlify actually removes/breaks v1 Functions
support (not just "doesn't recommend" it), or a concrete future requirement
needs something only `@netlify/identity` provides that `gotrue-js` genuinely
can't do (e.g. built-in OAuth provider support, if the sharing model ever
needs that).

## Key confirmed facts (verified against the real package and this repo, not summaries)

- v1 Functions (`export { handler }`) are explicitly unsupported by
  `@netlify/identity`'s server-side APIs — confirmed from its README. All 9
  of this app's backend functions are v1.
- The migration would be full-stack: `@netlify/identity` is cookie-based
  (`nf_jwt`/`nf_refresh`), not header-based like the current bearer-token
  wiring. Cookie attributes, confirmed from the bundled source: `httpOnly:
  false, secure: true, path: "/", sameSite: "Lax"`, no `Max-Age`/`Expires`
  (session cookies) — i.e. no real hardening improvement over the current
  localStorage-based token storage, just a different transport.
- `@netlify/identity@2.0.0`'s package is a typed wrapper: its own
  `package.json` depends on `gotrue-js@^1.0.1` and its bundled source
  literally reuses the key `"gotrue.user"` in `localStorage` — **the same key
  the current app's gotrue-js wrapper uses**. Any migration plan that "cleans
  up" the old library's localStorage session by clearing that key would
  delete the new library's own session too (this was caught only in the
  final review round, after four rounds had already treated it as safe).
- Loadable with no build step via
  `https://cdn.jsdelivr.net/npm/@netlify/identity@2.0.0/+esm` (jsdelivr
  resolves the internal `gotrue-js` import to another CDN URL — confirmed
  working, no bare unresolved specifiers).
- v2 `Context` (from `@netlify/functions`, already a devDependency — fine to
  leave as dev since only its `Context` *type* would be imported, erased by
  esbuild) includes `cookies`, `json()`, a pre-parsed `url: URL`.
  `@netlify/identity` reads `globalThis.Netlify.context` ambiently, which is
  why `getUser()`/`refreshSession()` take no arguments.
- Requires Node >=22.12.0; this site's deployed functions are already on
  `nodejs24.x` (confirmed via `.netlify/functions/manifest.json`) — no
  version pin needed, and pinning to 22 would have been a downgrade.
- Server-side `getUser()` does not auto-refresh; `refreshSession()` is
  separate and, per the README, only makes a network call within 60 seconds
  of expiry — a forged token with a far-future `exp` claim skips it entirely.
- `getUser()`'s behavior under an Identity-API outage is not fully
  documented: it's stated to never throw, and to fall back to JWT claims when
  the API is unreachable, but whether that fallback verifies the token
  signature isn't stated. This is a real regression risk, not a neutral
  unknown — today, v1's `context.clientContext.user` is verified by the
  platform itself before the function runs; moving auth into this library's
  fallback path trades a platform guarantee for a documented-unclear one.
  Any future attempt at this migration must treat "forged token + unreachable
  Identity → still 401" as a hard, blocking acceptance test, not an
  assumption in either direction.
- Recovery-session completeness is asserted more narrowly by the docs than
  a passwordless design would need: the `d.ts` says a recovery-callback user
  "is logged in but has **not** set a new password yet" and that the app
  "must" redirect to a password form — i.e. treating `handleAuthCallback()`'s
  recovery result as a complete login (which is what passwordless-only login
  would require) works today only because the current `2.0.0` implementation
  happens to fully log the user in regardless of what the docs say is
  required next. That's an unstated, version-fragile behavior to build a
  sole login path on.

## CSRF design that would be needed (not needed on the current bearer-token stack)

Moving to ambient cookies reopens CSRF risk this app doesn't have today.
Confirmed specifics if revisited:

- `SameSite=Lax` cookies still ride along on **top-level GET navigations** —
  and this app's `items-get.ts`/`download-everything.ts` do side-effecting
  work (audit-log writes) on GET, so a plain link could forge an audit entry
  or trigger a decrypted-backup download. `verifyRequestOrigin` can't be
  applied to GETs (it 403s on a missing `Origin` header, which same-origin
  GET `fetch()` never sends). The fix that was designed: a custom
  `X-Requested-With: fetch` header added to every request in `apiFetch`,
  since navigations can't set custom headers and cross-origin scripts
  attempting to would trigger an unapproved CORS preflight.
- For mutating endpoints: `@netlify/identity`'s exported
  `verifyRequestOrigin(request)` (confirmed to exist, throws 403 on a missing
  or mismatched `Origin`, defaults to comparing against `new URL(req.url).origin`)
  plus a `Content-Type: application/json` check (blocks classic HTML-form
  CSRF, which can't set that content type).
- **Open risk found in final review, unresolved**: `verifyRequestOrigin`'s
  default same-origin check compares against `request.url`'s own origin —
  behind Netlify's CDN, whether that resolves to the custom domain, the
  `*.netlify.app` host, or a branch alias wasn't verified. If it differs from
  the browser's real `Origin` in production, every mutation would 403 in
  production while passing on preview — and "don't run mutation tests on
  production" (a rule from the storage-isolation phase, adopted regardless of
  this migration) would prevent catching it before users hit it. A revived
  migration must test this with a safe non-writing mutation (e.g.
  `PUT items-update` with a nonexistent id, expecting 404, proving the origin
  check passed) directly against the real production hostname before
  trusting it.

## Method allowlisting + response-shape rewrite

All 9 functions would move from `export const handler = withAuth(...)` (v1)
to `export default withMutation(...)`/`withAuth(...)` (v2), with:

- `event.queryStringParameters.x` → `new URL(req.url).searchParams.get("x")`
- `JSON.parse(event.body)` → a `parseJsonBody(req)` helper that maps a
  `SyntaxError` at the parse boundary specifically to 400 (not a blanket
  `catch` that could misclassify an unrelated application bug)
- `{ statusCode, headers, body }` → real `Response` objects
- `items-update.ts` uses **PUT**, not POST (a mismatch an early draft of this
  plan got wrong by assuming POST for every mutation — confirmed by reading
  the actual file and its caller in `items.html`)
- `photos-upload.ts` must keep its own local catch around a version conflict
  to clean up orphaned encrypted blobs before returning 409 — centralizing
  that mapping in a shared wrapper would silently drop the cleanup
- `photos-get.ts`/`download-everything.ts` could return decrypted bytes / the
  zip buffer directly as the `Response` body instead of the current
  `isBase64Encoded: true` v1 workaround
- Confirmed TypeScript friction: `@netlify/identity`'s `User` type uses `id`
  (not `sub`) and every field except `id` is optional, including `email` —
  `lib/audit.ts`'s `logAudit(user, ...)` and `items.html`'s
  `author: user.email` both currently assume a non-optional string and would
  need a narrowed `AuthedUser = User & { email: string }` type threaded
  through the auth wrapper, not just a drop-in type swap

## Session-refresh design, and a race condition found in final review

Per-request server-side `refreshSession()` (as an early draft proposed,
calling it at the top of every function) would race the browser's own
documented background auto-refresh (fires ~60s before expiry) over the same
rotating refresh token. `items.html` fires up to 2 parallel `photos-get`
calls per photo plus the cover photo — a 6-photo item is 13 concurrent
requests, each independently calling `refreshSession()` if inside that
window. With token rotation, one refresh wins and the rest present an
already-rotated token → mass 401s mid-render. A later attempt should
consider dropping server-side `refreshSession()` entirely in favor of relying
on the browser having already refreshed via `getUser()` client-side before
any request goes out — but confirm first that removing bearer-header-style
"ensure a live credential exists before every fetch" logic on the client
doesn't reintroduce the same gap in a different shape.

## Storage isolation (the one fully independent part, adopted regardless)

Netlify Blobs stores are namespaced by name only, not by deploy context — a
preview deploy's `getStore("items")` is the exact same data as production's.
This was implemented in `lib/stores.ts` via a `BLOBS_STORE_PREFIX` env var
(fail-closed, with a positive `"production"` sentinel rather than
distinguishing `""` from `undefined`) independent of any auth-library
decision — see that file. `scripts/seed.ts` bypasses this entirely
(hardcodes real store names) and must never be pointed at anything but
production.

## Passwordless-specific findings (relevant again only if a future migration also keeps passwordless)

- **No break-glass**: with no password ever set/shown, losing email access
  means losing the account entirely, with no recovery path. Netlify
  Identity's custom email templates and custom sender address both require a
  Pro plan or higher (unverified whether this site is on Pro) — without it,
  the sign-in-link email is Netlify's stock **password recovery** template
  ("reset your password"), sent from `no-reply@netlify.com`, which reads
  confusingly (and spam-filter-riskily) for a flow that was never about a
  password. This risk exists on the shipped `gotrue-js`-based passwordless
  design too, not just a hypothetical migrated one — it's a property of
  reusing Netlify's hosted Identity recovery email, independent of which
  client library talks to it.
- The recovery-request endpoint is unauthenticated — anyone who knows an
  invited email address can trigger recovery emails to it; whether Netlify's
  hosted Identity enforces any rate limit on that isn't documented anywhere
  found during review. Untested: what `requestPasswordRecovery` does for an
  invited user who never accepted their invite (a likely real onboarding
  path if someone deletes their invite email and then tries "email me a
  sign-in link" instead).
- Token auto-redemption on page load (rather than gesture-gated behind a
  button click) is fragile: link-preview scanners in some mail clients
  execute page JS and can burn a single-use token before the real user
  clicks it; a reload with the token still in the URL re-attempts redemption
  on an already-spent token and throws unhandled. The shipped passwordless
  design gesture-gates this (a "Continue" button, not auto-fire) and always
  clears the token from the URL after every attempt — apply the same fix
  here if this migration is ever revived.
