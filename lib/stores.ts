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
        "prefix like 'test-'. Refusing to guess. Current value: " + JSON.stringify(raw)
    );
  }
  return raw === "production" ? "" : raw;
}

function getStoreOptions() {
  // In production, Netlify should provide NETLIFY_FUNCTIONS_TOKEN automatically.
  // Pass it explicitly to ensure Blobs can authenticate.
  const token = process.env.NETLIFY_FUNCTIONS_TOKEN;
  const siteId = process.env.NETLIFY_SITE_ID || "cdb3dfb5-c8e2-44ce-9f8b-1ca931c4dc1d";

  if (token && siteId) {
    return { token, siteId };
  }
  return {};
}

export function itemsStore() {
  return getStore(`${getStorePrefix()}items`, getStoreOptions());
}

export function photosStore() {
  return getStore(`${getStorePrefix()}photos`, getStoreOptions());
}

export function auditStore() {
  return getStore(`${getStorePrefix()}audit`, getStoreOptions());
}
