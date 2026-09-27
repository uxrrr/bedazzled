import type { Handler } from "@netlify/functions";
import { requireUser, unauthorizedResponse } from "../../lib/auth";
import { itemsStore, photosStore } from "../../lib/stores";
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

  const items = itemsStore();
  const photos = photosStore();

  const result = await items.getWithMetadata(itemId, { type: "arrayBuffer" });
  if (!result || !result.data) {
    return { statusCode: 404, body: JSON.stringify({ error: "Item not found" }) };
  }

  const item = decryptJson<Item>(Buffer.from(result.data), itemId);
  const target = item.photos.find((p) => p.id === photoId);
  if (!target) {
    return { statusCode: 404, body: JSON.stringify({ error: "Photo not found on item" }) };
  }

  item.photos = item.photos.filter((p) => p.id !== photoId);
  if (item.coverPhotoId === photoId) {
    item.coverPhotoId = item.photos[0]?.id ?? null;
  }
  item.updatedAt = new Date().toISOString();

  // Best-effort version check, not a true compare-and-swap — see items-update.ts.
  const currentVersion = Number(result.metadata?.version ?? 1);
  await items.set(itemId, toArrayBuffer(encryptJson(item, itemId)), {
    metadata: { version: currentVersion + 1 },
  });

  await photos.delete(target.full);
  await photos.delete(target.thumb);

  await logAudit(user, itemId, "delete-photo");

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(item),
  };
};
