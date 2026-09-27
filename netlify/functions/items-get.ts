import { withAuth } from "../../lib/auth";
import { loadItem } from "../../lib/versioned-item-store";
import { logAudit } from "../../lib/audit";

export const handler = withAuth(async (user, event) => {
  const id = event.queryStringParameters?.id;
  if (!id) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing id" }) };
  }

  const loaded = await loadItem(id);
  if (!loaded) {
    return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) };
  }

  await logAudit(user, id, "view-item");

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ETag: String(loaded.version),
    },
    body: JSON.stringify(loaded.item),
  };
});
