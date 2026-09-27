import type { Handler } from "@netlify/functions";
import { randomUUID } from "crypto";
import { requireUser, unauthorizedResponse } from "../../lib/auth";
import { itemsStore, photosStore } from "../../lib/stores";
import { decryptJson, encrypt, encryptJson } from "../../lib/crypto";
import { toArrayBuffer } from "../../lib/bytes";
import { logAudit } from "../../lib/audit";
import type { Item } from "../../lib/types";

// Client resizes to a "full" (display-size) and "thumb" (grid-size) image
// with canvas before calling this, and sends both as base64 — this keeps
// image processing off the server entirely (no native image lib on Lambda,
// no huge request payloads).
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

  const ifMatch = event.headers["if-match"] || event.headers["If-Match"];
  if (!ifMatch) {
    return { statusCode: 428, body: JSON.stringify({ error: "If-Match header required" }) };
  }

  const { itemId, fullBase64, thumbBase64, mime } = JSON.parse(event.body || "{}");
  if (!itemId || !fullBase64 || !thumbBase64 || !mime) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "itemId, fullBase64, thumbBase64, mime required" }),
    };
  }
  if (!mime.startsWith("image/")) {
    return { statusCode: 400, body: JSON.stringify({ error: "mime must be an image type" }) };
  }

  const items = itemsStore();
  const photos = photosStore();

  const result = await items.getWithMetadata(itemId, { type: "arrayBuffer" });
  if (!result || !result.data) {
    return { statusCode: 404, body: JSON.stringify({ error: "Item not found" }) };
  }

  // Best-effort version check, not a true compare-and-swap — see items-update.ts.
  const currentVersion = Number(result.metadata?.version ?? 1);
  if (String(currentVersion) !== ifMatch) {
    return {
      statusCode: 409,
      body: JSON.stringify({ error: "Item was changed by someone else, reload and retry" }),
    };
  }

  const item = decryptJson<Item>(Buffer.from(result.data), itemId);

  const photoId = randomUUID();
  const fullBlobId = `${photoId}-full`;
  const thumbBlobId = `${photoId}-thumb`;

  const fullBuf = Buffer.from(fullBase64, "base64");
  const thumbBuf = Buffer.from(thumbBase64, "base64");

  await photos.set(fullBlobId, toArrayBuffer(encrypt(fullBuf, `${fullBlobId}|${mime}`)));
  await photos.set(thumbBlobId, toArrayBuffer(encrypt(thumbBuf, `${thumbBlobId}|${mime}`)));

  item.photos.push({ id: photoId, full: fullBlobId, thumb: thumbBlobId, mime });
  if (!item.coverPhotoId) {
    item.coverPhotoId = photoId;
  }
  item.updatedAt = new Date().toISOString();

  const newVersion = currentVersion + 1;
  await items.set(itemId, toArrayBuffer(encryptJson(item, itemId)), {
    metadata: { version: newVersion },
  });

  await logAudit(user, itemId, "upload-photo");

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ETag: String(newVersion) },
    body: JSON.stringify(item),
  };
};
