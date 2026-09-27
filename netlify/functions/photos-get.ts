import type { Handler } from "@netlify/functions";
import { requireUser, unauthorizedResponse } from "../../lib/auth";
import { photosStore } from "../../lib/stores";
import { decrypt } from "../../lib/crypto";

// Returns decrypted image bytes. Never cached (Cache-Control: no-store) so
// browser/CDN caching can't quietly retain plaintext after the fact — the
// client is expected to fetch() this with a fresh Identity JWT and turn the
// response into an object URL, since <img src> can't carry an Authorization
// header.
export const handler: Handler = async (event, context) => {
  try {
    requireUser(context);
  } catch {
    return unauthorizedResponse();
  }

  const blobId = event.queryStringParameters?.blobId;
  const mime = event.queryStringParameters?.mime;
  if (!blobId || !mime) {
    return { statusCode: 400, body: JSON.stringify({ error: "blobId and mime required" }) };
  }

  const store = photosStore();
  const raw = await store.get(blobId, { type: "arrayBuffer" });
  if (!raw) {
    return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) };
  }

  const plaintext = decrypt(Buffer.from(raw), `${blobId}|${mime}`);

  return {
    statusCode: 200,
    headers: {
      "Content-Type": mime,
      "Cache-Control": "no-store",
    },
    body: plaintext.toString("base64"),
    isBase64Encoded: true,
  };
};
