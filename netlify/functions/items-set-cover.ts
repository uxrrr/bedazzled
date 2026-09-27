import type { Handler } from "@netlify/functions";
import { requireUser, unauthorizedResponse } from "../../lib/auth";
import { itemsStore } from "../../lib/stores";
import { decryptJson, encryptJson } from "../../lib/crypto";
import { toArrayBuffer } from "../../lib/bytes";
import { logAudit } from "../../lib/audit";
import type { Item } from "../../lib/types";

export const handler: Handler = async (event, context) => {
  let user;
  try {
    user = requireUser(context);
  } catch {
    return unauthorizedResponse();
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { itemId, photoId } = JSON.parse(event.body || "{}");
  if (!itemId || !photoId) {
    return { statusCode: 400, body: JSON.stringify({ error: "itemId and photoId required" }) };
  }

  const store = itemsStore();
  const result = await store.getWithMetadata(itemId, { type: "arrayBuffer" });
  if (!result || !result.data) {
    return { statusCode: 404, body: JSON.stringify({ error: "Item not found" }) };
  }

  const item = decryptJson<Item>(Buffer.from(result.data), itemId);
  if (!item.photos.some((p) => p.id === photoId)) {
    return { statusCode: 404, body: JSON.stringify({ error: "Photo not found on item" }) };
  }

  item.coverPhotoId = photoId;
  item.updatedAt = new Date().toISOString();

  // Best-effort version check, not a true compare-and-swap — see items-update.ts.
  const currentVersion = Number(result.metadata?.version ?? 1);
  const newVersion = currentVersion + 1;
  await store.set(itemId, toArrayBuffer(encryptJson(item, itemId)), {
    metadata: { version: newVersion },
  });

  await logAudit(user, itemId, "update-item");

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ETag: String(newVersion) },
    body: JSON.stringify(item),
  };
};
