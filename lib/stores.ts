import { getStore } from "@netlify/blobs";

export function itemsStore() {
  return getStore("items");
}

export function photosStore() {
  return getStore("photos");
}

export function auditStore() {
  return getStore("audit");
}
