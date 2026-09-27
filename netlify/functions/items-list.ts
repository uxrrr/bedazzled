import { withAuth } from "../../lib/auth";
import { itemsStore } from "../../lib/stores";
import { decryptJson } from "../../lib/crypto";
import type { Item } from "../../lib/types";

export const handler = withAuth(async () => {
  const store = itemsStore();
  const { blobs } = await store.list();

  const results = await Promise.all(
    blobs.map(async ({ key }) => {
      const raw = await store.get(key, { type: "arrayBuffer" });
      if (!raw) return null;
      try {
        return decryptJson<Item>(Buffer.from(raw), key);
      } catch (err) {
        console.error(`Failed to decrypt item ${key}`, err);
        return null;
      }
    })
  );

  const items = results.filter((item): item is Item => item !== null);
  items.sort((a, b) => (a.listNumber ?? 9999) - (b.listNumber ?? 9999));

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(items),
  };
});
