import { randomUUID } from "crypto";
import { withAuth, requireIfMatch, errorResponse } from "../../lib/auth";
import { photosStore } from "../../lib/stores";
import { encrypt } from "../../lib/crypto";
import { toArrayBuffer } from "../../lib/bytes";
import { loadItem, saveItem, VersionConflict } from "../../lib/versioned-item-store";
import { logAudit } from "../../lib/audit";

// Client resizes to a "full" (display-size) and "thumb" (grid-size) image
// with canvas before calling this, and sends both as base64 — this keeps
// image processing off the server entirely (no native image lib on Lambda,
// no huge request payloads). MAX_DECODED_BYTES is a belt-and-suspenders cap
// on the server side: the client is trusted to behave, but a modified/buggy
// client could send arbitrary bytes with a spoofed "image/jpeg" mime, so
// bound how much gets decrypted/stored regardless of what the client claims.
const MAX_DECODED_BYTES = 8 * 1024 * 1024;

export const handler = withAuth(async (user, event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const ifMatch = requireIfMatch(event);
  if (typeof ifMatch !== "string") return ifMatch;

  const { itemId, fullBase64, thumbBase64, mime } = JSON.parse(event.body || "{}");
  if (!itemId || !fullBase64 || !thumbBase64 || !mime) {
    return errorResponse(400, "itemId, fullBase64, thumbBase64, mime required");
  }
  if (!mime.startsWith("image/")) {
    return errorResponse(400, "mime must be an image type");
  }
  if (fullBase64.length > MAX_DECODED_BYTES * 1.4 || thumbBase64.length > MAX_DECODED_BYTES * 1.4) {
    return errorResponse(413, "Photo too large");
  }

  const loaded = await loadItem(itemId);
  if (!loaded) {
    return errorResponse(404, "Item not found");
  }
  const { item } = loaded;

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
    // saveItem does its own version check against Number(ifMatch); no need
    // to duplicate that comparison here first.
    newVersion = await saveItem(itemId, item, Number(ifMatch));
  } catch (err) {
    // Roll back the orphaned photo blobs since the item write didn't land.
    await Promise.all([photos.delete(fullBlobId), photos.delete(thumbBlobId)]);
    if (err instanceof VersionConflict) {
      return errorResponse(409, err.message);
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
