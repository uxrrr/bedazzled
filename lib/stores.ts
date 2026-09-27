import { getStore } from "@netlify/blobs";

// Blobs stores are namespaced by name only, not by deploy context — a
// preview deploy's getStore("items") is the exact same data as production's.
// BLOBS_STORE_PREFIX must be set explicitly per Netlify environment context
// (Production, Deploy Previews, Branch deploys, Local development).
// A positive sentinel ("production") is used rather than treating
// an empty string as "no prefix" — a value silently delivered as "" instead
// of unset must not be indistinguishable from a real prefix.
function getStorePrefix(): string {
  const raw = process.env.BLOBS_STORE_PREFIX;
  if (raw === undefined || raw === "") {
    throw new Error(
      "BLOBS_STORE_PREFIX must be set explicitly to 'production' or a test " +
        "prefix like 'test-'. Refusing to guess."
    );
  }
  return raw === "production" ? "" : raw;
}

// Automatic Blobs context detection isn't reliable in this project's deploy
// setup, so we authenticate explicitly with the same NETLIFY_SITE_ID /
// NETLIFY_BLOBS_TOKEN pair scripts/seed.ts already uses off-platform. A real
// Netlify Personal Access Token (User settings > Applications > Personal
// access tokens), not any auto-injected variable — an earlier attempt at
// this used a nonexistent NETLIFY_FUNCTIONS_TOKEN and silently no-opped.
function getStoreOptions() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  if (!siteID || !token) {
    throw new Error(
      "NETLIFY_SITE_ID and NETLIFY_BLOBS_TOKEN must both be set for Netlify " +
        "Blobs to authenticate."
    );
  }
  return { siteID, token };
}

export function itemsStore() {
  return getStore({ name: `${getStorePrefix()}items`, ...getStoreOptions() });
}

export function photosStore() {
  return getStore({ name: `${getStorePrefix()}photos`, ...getStoreOptions() });
}

export function auditStore() {
  return getStore({ name: `${getStorePrefix()}audit`, ...getStoreOptions() });
}
