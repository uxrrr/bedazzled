// Thin wrapper around gotrue-js (loaded directly from CDN as an ES module),
// the stable client library that netlify-identity-widget wraps. We use it
// directly instead of the widget because the widget injects its own DOM
// overlay/iframe that has repeatedly proven unreliable (invite/recovery
// tokens silently failing to show a password form, or leaving behind an
// invisible click-eating overlay). This module has no UI of its own — every
// page builds its own plain HTML forms and calls these functions.
const GOTRUE_CDN = "https://cdn.jsdelivr.net/npm/gotrue-js@1.0.1/lib/index.min.js";

let gotruePromise = null;
export function getGotrue() {
  if (!gotruePromise) {
    gotruePromise = import(GOTRUE_CDN).then(
      ({ default: GoTrue }) =>
        new GoTrue({
          APIUrl: window.location.origin + "/.netlify/identity",
          setCookie: false,
        })
    );
  }
  return gotruePromise;
}

export async function currentUser() {
  const gotrue = await getGotrue();
  return gotrue.currentUser();
}

// True when the URL carries a one-time invite or recovery token — pages use
// this to show their own password-set form instead of redirecting to login.
export function getPendingAuthAction() {
  const combined =
    window.location.hash.replace(/^#/, "") + "&" + window.location.search.replace(/^\?/, "");
  const params = new URLSearchParams(combined);
  const invite = params.get("invite_token");
  const recovery = params.get("recovery_token");
  if (invite) return { kind: "invite", token: invite };
  if (recovery) return { kind: "recovery", token: recovery };
  return null;
}

export async function requireLogin() {
  if (getPendingAuthAction()) return null;
  const user = await currentUser();
  if (!user) {
    window.location.href = "/login.html";
    return null;
  }
  return user;
}

// Always mints/refreshes the JWT right before use — Identity tokens expire
// hourly, and caching one leads to images silently 401ing after that.
export async function authHeaders() {
  const user = await currentUser();
  if (!user) {
    window.location.href = "/login.html";
    throw new Error("Not logged in");
  }
  const token = await user.jwt();
  return { Authorization: `Bearer ${token}` };
}

export async function logout() {
  const user = await currentUser();
  if (user) await user.logout();
}
