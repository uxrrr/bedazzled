import { withAuth, requireIfMatch, errorResponse } from "../../lib/auth";
import { photosStore } from "../../lib/stores";
import { loadItem, saveItem, VersionConflict } from "../../lib/versioned-item-store";
import { logAudit } from "../../lib/audit";

export const handler = withAuth(async (user, event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const ifMatch = requireIfMatch(event);
  if (typeof ifMatch !== "string") return ifMatch;

  const { itemId, photoId } = JSON.parse(event.body || "{}");
  if (!itemId || !photoId) {
    return errorResponse(400, "itemId and photoId required");
  }

  const loaded = await loadItem(itemId);
  if (!loaded) {
    return errorResponse(404, "Item not found");
  }
  const { item } = loaded;

  const target = item.photos.find((p) => p.id === photoId);
  if (!target) {
    return errorResponse(404, "Photo not found on item");
  }

  item.photos = item.photos.filter((p) => p.id !== photoId);
  if (item.coverPhotoId === photoId) {
    item.coverPhotoId = item.photos[0]?.id ?? null;
  }

  let newVersion: number;
  try {
    newVersion = await saveItem(itemId, item, Number(ifMatch));
  } catch (err) {
    if (err instanceof VersionConflict) {
      return errorResponse(409, err.message);
    }
    throw err;
  }

  const photos = photosStore();
  await Promise.all([photos.delete(target.full), photos.delete(target.thumb)]);

  await logAudit(user, itemId, "delete-photo");

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ETag: String(newVersion) },
    body: JSON.stringify(item),
  };
});
