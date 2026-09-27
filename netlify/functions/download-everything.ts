import type { Handler } from "@netlify/functions";
import archiver from "archiver";
import { PassThrough } from "stream";
import { requireUser, unauthorizedResponse } from "../../lib/auth";
import { itemsStore, photosStore } from "../../lib/stores";
import { decrypt, decryptJson } from "../../lib/crypto";
import { logAudit } from "../../lib/audit";
import type { Item } from "../../lib/types";

// One-click backup: the site is a viewer over data the user still owns
// elsewhere, not the sole home for it. This zips every item's decrypted JSON
// plus every decrypted photo so there's a real, actually-clickable backup
// path rather than a script nobody will remember to run.
//
// Note: standard Netlify Functions responses cap out around 6MB. With ~16
// items and client-resized "full" photos (aim for max ~1600px on the long
// edge at upload time) this should comfortably fit, but if the collection
// grows a lot this function would need to switch to a background function
// that uploads the zip to a temporary blob and returns a download link
// instead of returning the zip bytes directly.
export const handler: Handler = async (event, context) => {
  let user;
  try {
    user = requireUser(context);
  } catch {
    return unauthorizedResponse();
  }

  const items = itemsStore();
  const photos = photosStore();
  const { blobs } = await items.list();

  const chunks: Buffer[] = [];
  const stream = new PassThrough();
  stream.on("data", (chunk) => chunks.push(chunk));

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.pipe(stream);

  const manifest: Item[] = [];

  for (const { key } of blobs) {
    const raw = await items.get(key, { type: "arrayBuffer" });
    if (!raw) continue;
    const item = decryptJson<Item>(Buffer.from(raw), key);
    manifest.push(item);

    for (const photo of item.photos) {
      const fullRaw = await photos.get(photo.full, { type: "arrayBuffer" });
      if (fullRaw) {
        const plaintext = decrypt(Buffer.from(fullRaw), `${photo.full}|${photo.mime}`);
        const ext = photo.mime.split("/")[1] || "jpg";
        archive.append(plaintext, { name: `photos/${item.listNumber ?? "x"}-${item.id}-${photo.id}.${ext}` });
      }
    }
  }

  archive.append(JSON.stringify(manifest, null, 2), { name: "items.json" });
  await archive.finalize();

  await new Promise((resolve) => stream.on("end", resolve));
  const zipBuffer = Buffer.concat(chunks);

  await logAudit(user, null, "download-everything");

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="jewelry-appraisal-backup-${Date.now()}.zip"`,
      "Cache-Control": "no-store",
    },
    body: zipBuffer.toString("base64"),
    isBase64Encoded: true,
  };
};
