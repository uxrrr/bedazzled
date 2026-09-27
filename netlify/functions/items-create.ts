import type { Handler } from "@netlify/functions";
import { randomUUID } from "crypto";
import { requireUser, unauthorizedResponse } from "../../lib/auth";
import { itemsStore } from "../../lib/stores";
import { encryptJson } from "../../lib/crypto";
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

  // @netlify/blobs has no conditional-write API, so concurrency is handled
  // manually via a version number in blob metadata (see items-update.ts).
  // Collision on a fresh randomUUID() id is not a practical concern here.
  const store = itemsStore();
  await store.set(id, toArrayBuffer(encryptJson(item, id)), { metadata: { version: 1 } });

  await logAudit(user, id, "create-item");

  return {
    statusCode: 201,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ETag: "1" },
    body: JSON.stringify(item),
  };
};
