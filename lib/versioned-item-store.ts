import { itemsStore } from "./stores";
import { decryptJson } from "./crypto";
import type { Item } from "./types";

export interface LoadedItem {
  item: Item;
  version: number;
}

export async function loadItem(id: string): Promise<LoadedItem | null> {
  const result = await itemsStore().getWithMetadata(id, { type: "arrayBuffer" });
  if (!result || !result.data) return null;
  return {
    item: decryptJson<Item>(Buffer.from(result.data), id),
    version: Number(result.metadata?.version ?? 1),
  };
}
