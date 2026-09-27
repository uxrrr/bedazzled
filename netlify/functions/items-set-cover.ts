import { withAuth } from "../../lib/auth";
import { loadItem, saveItem, VersionConflict } from "../../lib/versioned-item-store";
import { logAudit } from "../../lib/audit";

export const handler = withAuth(async (user, event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const ifMatch = event.headers["if-match"] || event.headers["If-Match"];
  if (!ifMatch) {
    return { statusCode: 428, body: JSON.stringify({ error: "If-Match header required" }) };
  }

  const { itemId, photoId } = JSON.parse(event.body || "{}");
  if (!itemId || !photoId) {
    return { statusCode: 400, body: JSON.stringify({ error: "itemId and photoId required" }) };
  }

  const loaded = await loadItem(itemId);
  if (!loaded) {
    return { statusCode: 404, body: JSON.stringify({ error: "Item not found" }) };
  }
  const { item } = loaded;

  if (!item.photos.some((p) => p.id === photoId)) {
    return { statusCode: 404, body: JSON.stringify({ error: "Photo not found on item" }) };
  }
  item.coverPhotoId = photoId;

  let newVersion: number;
  try {
    newVersion = await saveItem(itemId, item, Number(ifMatch));
  } catch (err) {
    if (err instanceof VersionConflict) {
      return { statusCode: 409, body: JSON.stringify({ error: err.message }) };
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
