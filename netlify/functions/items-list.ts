import type { Handler } from "@netlify/functions";
import { requireUser, unauthorizedResponse } from "../../lib/auth";
import { itemsStore } from "../../lib/stores";
import { decryptJson } from "../../lib/crypto";
import type { Item } from "../../lib/types";

export const handler: Handler = async (event, context) => {
  let user;
  try {
    user = requireUser(context);
  } catch {
    return unauthorizedResponse();
  }
  void user;

  const store = itemsStore();
  const { blobs } = await store.list();

  const items: Item[] = [];
  for (const { key } of blobs) {
    const raw = await store.get(key, { type: "arrayBuffer" });
    if (!raw) continue;
    try {
      items.push(decryptJson<Item>(Buffer.from(raw), key));
    } catch (err) {
      console.error(`Failed to decrypt item ${key}`, err);
    }
  }

  items.sort((a, b) => (a.listNumber ?? 9999) - (b.listNumber ?? 9999));

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(items),
  };
};
