import { randomUUID } from "crypto";
import { withAuth } from "../../lib/auth";
import { photosStore } from "../../lib/stores";
import { encrypt } from "../../lib/crypto";
import { toArrayBuffer } from "../../lib/bytes";
import { loadItem, saveItem, VersionConflict } from "../../lib/versioned-item-store";
import { logAudit } from "../../lib/audit";

// Client resizes to a "full" (display-size) and "thumb" (grid-size) image
// with canvas before calling this, and sends both as base64 — this keeps
// image processing off the server entirely (no native image lib on Lambda,
// no huge request payloads).
export const handler = withAuth(async (user, event) => {
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

  const loaded = await loadItem(itemId);
  if (!loaded) {
    return { statusCode: 404, body: JSON.stringify({ error: "Item not found" }) };
  }
  const { item } = loaded;
  if (String(loaded.version) !== ifMatch) {
    return {
      statusCode: 409,
      body: JSON.stringify({ error: "Item was changed by someone else, reload and retry" }),
    };
  }

  const photos = photosStore();
  const photoId = randomUUID();
  const fullBlobId = `${photoId}-full`;
  const thumbBlobId = `${photoId}-thumb`;

  await photos.set(fullBlobId, toArrayBuffer(encrypt(Buffer.from(fullBase64, "base64"), `${fullBlobId}|${mime}`)));
  await photos.set(thumbBlobId, toArrayBuffer(encrypt(Buffer.from(thumbBase64, "base64"), `${thumbBlobId}|${mime}`)));

  item.photos.push({ id: photoId, full: fullBlobId, thumb: thumbBlobId, mime });
  if (!item.coverPhotoId) {
    item.coverPhotoId = photoId;
  }

  let newVersion: number;
  try {
    newVersion = await saveItem(itemId, item, loaded.version);
  } catch (err) {
    // Roll back the orphaned photo blobs since the item write didn't land.
    await photos.delete(fullBlobId);
    await photos.delete(thumbBlobId);
    if (err instanceof VersionConflict) {
      return { statusCode: 409, body: JSON.stringify({ error: err.message }) };
    }
    throw err;
  }

  await logAudit(user, itemId, "upload-photo");

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ETag: String(newVersion) },
    body: JSON.stringify(item),
  };
});
