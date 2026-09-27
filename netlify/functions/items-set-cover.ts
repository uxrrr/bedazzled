import { withAuth, requireIfMatch, errorResponse } from "../../lib/auth";
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

  if (!item.photos.some((p) => p.id === photoId)) {
    return errorResponse(404, "Photo not found on item");
  }
  item.coverPhotoId = photoId;

  let newVersion: number;
  try {
    newVersion = await saveItem(itemId, item, Number(ifMatch));
  } catch (err) {
    if (err instanceof VersionConflict) {
      return errorResponse(409, err.message);
    }
    throw err;
  }

  await logAudit(user, itemId, "update-item");

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ETag: String(newVersion) },
    body: JSON.stringify(item),
  };
});
