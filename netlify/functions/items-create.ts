import { randomUUID } from "crypto";
import { withAuth } from "../../lib/auth";
import { createItem } from "../../lib/versioned-item-store";
import { logAudit } from "../../lib/audit";
import type { Item } from "../../lib/types";

export const handler = withAuth(async (user, event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const body = event.body ? JSON.parse(event.body) : {};
  const now = new Date().toISOString();
  const id = randomUUID();

  const item: Item = {
    id,
    listNumber: typeof body.listNumber === "number" ? body.listNumber : null,
    title: typeof body.title === "string" ? body.title : "Untitled item",
    notes: [],
    category: typeof body.category === "string" ? body.category : "",
    photos: [],
    coverPhotoId: null,
    comps: [],
    createdAt: now,
    updatedAt: now,
  };

  const version = await createItem(item);
  await logAudit(user, id, "create-item");

  return {
    statusCode: 201,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ETag: String(version) },
    body: JSON.stringify(item),
  };
});
