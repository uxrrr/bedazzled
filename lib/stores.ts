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

export function itemsStore() {
  return getStore(`${getStorePrefix()}items`);
}

export function photosStore() {
  return getStore(`${getStorePrefix()}photos`);
}

export function auditStore() {
  return getStore(`${getStorePrefix()}audit`);
}
