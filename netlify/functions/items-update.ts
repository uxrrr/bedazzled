import type { Handler } from "@netlify/functions";
import { requireUser, unauthorizedResponse } from "../../lib/auth";
import { itemsStore } from "../../lib/stores";
import { encryptJson } from "../../lib/crypto";
import { toArrayBuffer } from "../../lib/bytes";
import { logAudit } from "../../lib/audit";
import type { Item } from "../../lib/types";

// @netlify/blobs has no conditional/compare-and-swap write API (its set()
// only takes {metadata} and returns void) — this is a best-effort optimistic
// concurrency check via a version number in blob metadata, not a true atomic
// compare-and-swap. There's a small race window between the read and the
// write below. That's an acceptable tradeoff for a handful of trusted
// collaborators occasionally editing the same item, not a hard guarantee.
export const handler: Handler = async (event, context) => {
  let user;
  try {
    user = requireUser(context);
  } catch {
    return unauthorizedResponse();
  }

  if (event.httpMethod !== "PUT") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const ifMatch = event.headers["if-match"] || event.headers["If-Match"];
  if (!ifMatch) {
    return { statusCode: 428, body: JSON.stringify({ error: "If-Match header required" }) };
  }

  const item: Item = JSON.parse(event.body || "{}");
  if (!item.id) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing item id" }) };
  }

  const store = itemsStore();
  const current = await store.getMetadata(item.id);
  if (!current) {
    return { statusCode: 404, body: JSON.stringify({ error: "Item not found" }) };
  }

  const currentVersion = Number(current.metadata?.version ?? 1);
  if (String(currentVersion) !== ifMatch) {
    return {
      statusCode: 409,
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({ error: "Item was changed by someone else, reload and retry" }),
    };
  }

  const newVersion = currentVersion + 1;
  item.updatedAt = new Date().toISOString();

  await store.set(item.id, toArrayBuffer(encryptJson(item, item.id)), {
    metadata: { version: newVersion },
  });

  await logAudit(user, item.id, "update-item");

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ETag: String(newVersion) },
    body: JSON.stringify(item),
  };
};
