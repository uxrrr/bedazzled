import archiver from "archiver";
import { PassThrough } from "stream";
import { withAuth } from "../../lib/auth";
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
export const handler = withAuth(async (user) => {
  const items = itemsStore();
  const photos = photosStore();
  const { blobs } = await items.list();

  // Fetch + decrypt all items in parallel rather than one at a time.
  const loadedItems = (
    await Promise.all(
      blobs.map(async ({ key }) => {
        const raw = await items.get(key, { type: "arrayBuffer" });
        return raw ? decryptJson<Item>(Buffer.from(raw), key) : null;
      })
    )
  ).filter((item): item is Item => item !== null);

  // Fetch + decrypt every photo across every item in parallel too.
  const photoJobs = loadedItems.flatMap((item) =>
    item.photos.map(async (photo) => {
      const fullRaw = await photos.get(photo.full, { type: "arrayBuffer" });
      if (!fullRaw) return null;
      const plaintext = decrypt(Buffer.from(fullRaw), `${photo.full}|${photo.mime}`);
      const ext = photo.mime.split("/")[1] || "jpg";
      return { name: `photos/${item.listNumber ?? "x"}-${item.id}-${photo.id}.${ext}`, plaintext };
    })
  );
  const photoFiles = (await Promise.all(photoJobs)).filter((f): f is NonNullable<typeof f> => f !== null);

  const zipBuffer = await buildZip(loadedItems, photoFiles);

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
});

function buildZip(items: Item[], photoFiles: { name: string; plaintext: Buffer }[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = new PassThrough();
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", reject);
    archive.pipe(stream);

    for (const file of photoFiles) {
      archive.append(file.plaintext, { name: file.name });
    }
    archive.append(JSON.stringify(items, null, 2), { name: "items.json" });
    archive.finalize();
  });
}
