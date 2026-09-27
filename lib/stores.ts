import { getStore } from "@netlify/blobs";

// Blobs stores are namespaced by name only, not by deploy context — a
// preview deploy's getStore("items") is the exact same data as production's.
// BLOBS_STORE_PREFIX must be set explicitly per Netlify environment context
// (Production, Deploy Previews, Branch deploys, Local development), scoped to
// Functions. A positive sentinel ("production") is used rather than treating
// an empty string as "no prefix" — a value silently delivered as "" instead
// of unset must not be indistinguishable from a real prefix, and there is no
// value under which this throws by accident.
const raw = process.env.BLOBS_STORE_PREFIX;
if (raw === undefined || raw === "") {
  throw new Error(
    "BLOBS_STORE_PREFIX must be set explicitly to 'production' or a test " +
      "prefix like 'test-'. Refusing to guess."
  );
}
const STORE_PREFIX = raw === "production" ? "" : raw;

export function itemsStore() {
  return getStore(`${STORE_PREFIX}items`);
}

export function photosStore() {
  return getStore(`${STORE_PREFIX}photos`);
}

export function auditStore() {
  return getStore(`${STORE_PREFIX}audit`);
}
