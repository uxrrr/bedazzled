import type { Handler } from "@netlify/functions";
import { requireUser, unauthorizedResponse } from "../../lib/auth";
import { itemsStore } from "../../lib/stores";
import { decryptJson } from "../../lib/crypto";
import { logAudit } from "../../lib/audit";
import type { Item } from "../../lib/types";

export const handler: Handler = async (event, context) => {
  let user;
  try {
    user = requireUser(context);
  } catch {
    return unauthorizedResponse();
  }

  const id = event.queryStringParameters?.id;
  if (!id) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing id" }) };
  }

  const store = itemsStore();
  const result = await store.getWithMetadata(id, { type: "arrayBuffer" });
  if (!result || !result.data) {
    return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) };
  }

  const item = decryptJson<Item>(Buffer.from(result.data), id);
  const version = String(result.metadata?.version ?? 1);

  await logAudit(user, id, "view-item");

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ETag: version,
    },
    body: JSON.stringify(item),
  };
};
