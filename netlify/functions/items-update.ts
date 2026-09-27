import type { HandlerResponse } from "@netlify/functions";
import { withAuth, requireIfMatch, errorResponse } from "../../lib/auth";
import { loadItem, saveItem, VersionConflict } from "../../lib/versioned-item-store";
import { logAudit } from "../../lib/audit";
import type { Item } from "../../lib/types";

// Client sends the full updated Item plus the If-Match header it got back
// from items-get.ts / items-create.ts. See lib/versioned-item-store.ts for
// how the version check works and its limits.
export const handler = withAuth(async (user, event): Promise<HandlerResponse> => {
  if (event.httpMethod !== "PUT") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const ifMatch = requireIfMatch(event);
  if (typeof ifMatch !== "string") return ifMatch;

  const item: Item = JSON.parse(event.body || "{}");
  if (!item.id) {
    return errorResponse(400, "Missing item id");
  }

  // Confirm the item actually exists before writing — saveItem alone can't
  // tell "stale version" from "no such item" (a missing blob's version
  // defaults the same way a real version 1 would).
  const existing = await loadItem(item.id);
  if (!existing) {
    return errorResponse(404, "Item not found");
  }

  let newVersion: number;
  try {
    newVersion = await saveItem(item.id, item, Number(ifMatch));
  } catch (err) {
    if (err instanceof VersionConflict) {
      return errorResponse(409, err.message);
    }
    throw err;
  }

  await logAudit(user, item.id, "update-item");

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ETag: String(newVersion) },
    body: JSON.stringify(item),
  };
});
