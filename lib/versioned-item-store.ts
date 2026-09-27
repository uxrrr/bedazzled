import { itemsStore } from "./stores";
import { decryptJson, encryptJson } from "./crypto";
import { toArrayBuffer } from "./bytes";
import type { Item } from "./types";

// @netlify/blobs has no conditional-write API (set() only takes {metadata},
// returns void) — this is a best-effort optimistic-concurrency mechanism via
// a version number in blob metadata, not a true atomic compare-and-swap.
// There's a small race window between the version check and the write.
// That's an acceptable tradeoff for a handful of trusted collaborators
// occasionally editing the same item, not a hard guarantee.
//
// Centralized here (rather than reimplemented per function) so every write
// path enforces the same check — this consolidates a version that used to be
// copy-pasted across four functions, two of which had silently stopped
// checking the version at all.

export interface LoadedItem {
  item: Item;
  version: number;
}

export class VersionConflict extends Error {
  constructor() {
    super("Item was changed by someone else, reload and retry");
  }
}

export async function loadItem(id: string): Promise<LoadedItem | null> {
  const result = await itemsStore().getWithMetadata(id, { type: "arrayBuffer" });
  if (!result || !result.data) return null;
  return {
    item: decryptJson<Item>(Buffer.from(result.data), id),
    version: Number(result.metadata?.version ?? 1),
  };
}

/** Writes `item` with version+1, but only if the stored version still matches `expectedVersion`. */
export async function saveItem(id: string, item: Item, expectedVersion: number): Promise<number> {
  const store = itemsStore();
  const current = await store.getMetadata(id);
  const currentVersion = Number(current?.metadata?.version ?? 1);
  if (currentVersion !== expectedVersion) {
    throw new VersionConflict();
  }
  const newVersion = currentVersion + 1;
  item.updatedAt = new Date().toISOString();
  await store.set(id, toArrayBuffer(encryptJson(item, id)), { metadata: { version: newVersion } });
  return newVersion;
}

export async function createItem(item: Item): Promise<number> {
  await itemsStore().set(item.id, toArrayBuffer(encryptJson(item, item.id)), {
    metadata: { version: 1 },
  });
  return 1;
}
