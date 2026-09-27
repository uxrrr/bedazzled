import { withAuth } from "../../lib/auth";
import { photosStore } from "../../lib/stores";
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

  const target = item.photos.find((p) => p.id === photoId);
  if (!target) {
    return { statusCode: 404, body: JSON.stringify({ error: "Photo not found on item" }) };
  }

  item.photos = item.photos.filter((p) => p.id !== photoId);
  if (item.coverPhotoId === photoId) {
    item.coverPhotoId = item.photos[0]?.id ?? null;
  }

  try {
    await saveItem(itemId, item, Number(ifMatch));
  } catch (err) {
    if (err instanceof VersionConflict) {
      return { statusCode: 409, body: JSON.stringify({ error: err.message }) };
    }
    throw err;
  }

  const photos = photosStore();
  await photos.delete(target.full);
  await photos.delete(target.thumb);

  await logAudit(user, itemId, "delete-photo");

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(item),
  };
});
