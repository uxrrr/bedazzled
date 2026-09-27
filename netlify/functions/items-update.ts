import type { HandlerResponse } from "@netlify/functions";
import { withAuth } from "../../lib/auth";
import { saveItem, VersionConflict } from "../../lib/versioned-item-store";
import { logAudit } from "../../lib/audit";
import type { Item } from "../../lib/types";

// Client sends the full updated Item plus the If-Match header it got back
// from items-get.ts / items-create.ts. See lib/versioned-item-store.ts for
// how the version check works and its limits.
export const handler = withAuth(async (user, event): Promise<HandlerResponse> => {
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

  let newVersion: number;
  try {
    newVersion = await saveItem(item.id, item, Number(ifMatch));
  } catch (err) {
    if (err instanceof VersionConflict) {
      return {
        statusCode: 409,
        headers: { "Cache-Control": "no-store" },
        body: JSON.stringify({ error: err.message }),
      };
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
