/**
 * One-time script to seed the 16 items from the handwritten June 2, 2026
 * inventory list, plus their matched photos.
 *
 * This runs locally against the PRODUCTION Netlify Blobs store (local `netlify
 * dev` can't read/write prod Blobs), using a scoped site ID + token — set
 * NETLIFY_SITE_ID, NETLIFY_BLOBS_TOKEN, and PHOTO_ENC_KEY in a local .env
 * before running (see .env.example). Uses `sharp` for thumbnailing here only
 * because this is a one-off local script, not a deployed Netlify Function —
 * the deployed upload path stays browser/canvas-based to avoid a native
 * image dependency on Lambda.
 *
 * IMPORTANT: after seeding, open the site and verify every title/note against
 * the original handwritten list — these were transcribed from a photo of
 * handwriting and could contain transcription errors.
 *
 * Run with: npm run seed
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { getStore } from "@netlify/blobs";
import sharp from "sharp";
import { encrypt, encryptJson } from "../lib/crypto";
import { toArrayBuffer } from "../lib/bytes";
import type { Item } from "../lib/types";

const PICS_DIR =
  "/Users/marksafire/Library/Mobile Documents/com~apple~CloudDocs/Documents/Claude/Jan/pics";

const siteConfig = {
  siteID: process.env.NETLIFY_SITE_ID!,
  token: process.env.NETLIFY_BLOBS_TOKEN!,
};

function store(name: string) {
  return getStore({ name, ...siteConfig });
}

interface SeedItem {
  listNumber: number;
  title: string;
  category: string;
  note: string;
  photoFiles: string[]; // filenames in PICS_DIR, first is the cover photo
}

// Photo matches from visual review of all 24 files against the handwritten
// list (IMG_6771.jpeg is a photo of the list itself, not an item; IMG_6752.jpeg
// didn't match anything). Item 7 (star sapphire snail) has no photo — none of
// the 24 files matched it. Item 6 is a two-piece lot (cameo + ring), item 11's
// "Fanny" engraving wasn't visible in any shot but the compact itself is.
// Verify all of this against the physical items before relying on it.
const SEED_ITEMS: SeedItem[] = [
  {
    listNumber: 1,
    title: "Feather brooch with pearl/diamond earrings",
    category: "brooch + earrings",
    note: "Transcribed from handwritten inventory, June 2, 2026.",
    photoFiles: ["IMG_6745.jpeg"],
  },
  {
    listNumber: 2,
    title: "Diamond ruby snuff box",
    category: "snuff box",
    note: "Transcribed from handwritten inventory, June 2, 2026.",
    photoFiles: ["IMG_6746.jpeg"],
  },
  {
    listNumber: 3,
    title: "Engagement ring",
    category: "ring",
    note: "Transcribed from handwritten inventory, June 2, 2026.",
    photoFiles: ["IMG_6747.jpeg", "IMG_6748.jpeg"],
  },
  {
    listNumber: 4,
    title: "String of pearl & diamond necklace",
    category: "necklace",
    note: "Transcribed from handwritten inventory, June 2, 2026.",
    photoFiles: ["IMG_6749.jpeg"],
  },
  {
    listNumber: 5,
    title: "Ruby & gold brooch",
    category: "brooch",
    note: "Transcribed from handwritten inventory, June 2, 2026.",
    photoFiles: ["IMG_6750.jpeg"],
  },
  {
    listNumber: 6,
    title: "Coral cameo / pearl & diamond ring",
    category: "cameo + ring",
    note: "Transcribed from handwritten inventory, June 2, 2026.",
    photoFiles: ["IMG_6751.jpeg", "IMG_6753.jpeg"],
  },
  {
    listNumber: 7,
    title: "Star sapphire snail / diamonds",
    category: "brooch or pendant",
    note: "Transcribed from handwritten inventory, June 2, 2026.",
    photoFiles: [],
  },
  {
    listNumber: 8,
    title: "Pocket watch / diamonds",
    category: "watch",
    note: "Transcribed from handwritten inventory, June 2, 2026.",
    photoFiles: ["IMG_6755.jpeg"],
  },
  {
    listNumber: 9,
    title: "Tie pin or hat pin — emerald/ruby",
    category: "pin",
    note: "Transcribed from handwritten inventory, June 2, 2026.",
    photoFiles: ["IMG_6756.jpeg"],
  },
  {
    listNumber: 10,
    title: "Gold & emerald tassel neck piece",
    category: "necklace",
    note: "Transcribed from handwritten inventory, June 2, 2026.",
    photoFiles: ["IMG_6757.jpeg", "IMG_6758.jpeg"],
  },
  {
    listNumber: 11,
    title: 'Compact — with "Fanny" name on back',
    category: "compact",
    note: "Transcribed from handwritten inventory, June 2, 2026.",
    photoFiles: ["IMG_6760.jpeg", "IMG_6764.jpeg", "IMG_6765.jpeg"],
  },
  {
    listNumber: 12,
    title: "Order of the Garter",
    category: "badge/medal",
    note: "Transcribed from handwritten inventory, June 2, 2026.",
    photoFiles: ["IMG_6762.jpeg", "IMG_6763.jpeg"],
  },
  {
    listNumber: 13,
    title: "Gold patch box",
    category: "patch box",
    note: "Transcribed from handwritten inventory, June 2, 2026.",
    photoFiles: ["IMG_6759.jpeg"],
  },
  {
    listNumber: 14,
    title: "Pearl & silver cuff links",
    category: "cuff links",
    note: "Transcribed from handwritten inventory, June 2, 2026.",
    photoFiles: ["IMG_6766.jpeg"],
  },
  {
    listNumber: 15,
    title: "Brooch — dragon, diamond with ruby eye",
    category: "brooch",
    note: "Transcribed from handwritten inventory, June 2, 2026.",
    photoFiles: ["IMG_6767.jpeg"],
  },
  {
    listNumber: 16,
    title: "Amethyst & pearls — 3-row necklace",
    category: "necklace",
    note: "Transcribed from handwritten inventory, June 2, 2026.",
    photoFiles: ["IMG_6768.jpeg", "IMG_6769.jpeg"],
  },
];

// Thumbnails can be small; full images need enough detail for a ballpark
// appraisal (hallmarks, stone inclusions), so they get a looser target.
const THUMB_TARGET_BYTES = 100 * 1024;
const FULL_TARGET_BYTES = 1.5 * 1024 * 1024;

async function resizeToBuffer(inputPath: string, maxDim: number, targetBytes: number): Promise<Buffer> {
  let dim = maxDim;
  for (let attempt = 0; attempt < 4; attempt++) {
    for (let quality = 90; quality >= 50; quality -= 10) {
      const buf = await sharp(inputPath)
        .rotate()
        .resize({ width: dim, height: dim, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer();
      if (buf.length <= targetBytes || (dim <= 320 && quality <= 50)) return buf;
    }
    dim = Math.round(dim * 0.75);
  }
  return sharp(inputPath).rotate().resize({ width: 320 }).jpeg({ quality: 50 }).toBuffer();
}

async function addPhoto(itemsStore: ReturnType<typeof store>, photosStore: ReturnType<typeof store>, item: Item, filePath: string) {
  const full = await resizeToBuffer(filePath, 2000, FULL_TARGET_BYTES);
  const thumb = await resizeToBuffer(filePath, 320, THUMB_TARGET_BYTES);

  const photoId = randomUUID();
  const fullBlobId = `${photoId}-full`;
  const thumbBlobId = `${photoId}-thumb`;
  const mime = "image/jpeg";

  await photosStore.set(fullBlobId, toArrayBuffer(encrypt(full, `${fullBlobId}|${mime}`)));
  await photosStore.set(thumbBlobId, toArrayBuffer(encrypt(thumb, `${thumbBlobId}|${mime}`)));

  item.photos.push({ id: photoId, full: fullBlobId, thumb: thumbBlobId, mime });
  if (!item.coverPhotoId) item.coverPhotoId = photoId;
}

async function main() {
  if (!siteConfig.siteID || !siteConfig.token) {
    throw new Error("Set NETLIFY_SITE_ID and NETLIFY_BLOBS_TOKEN before running seed.ts");
  }
  if (!process.env.PHOTO_ENC_KEY) {
    throw new Error("Set PHOTO_ENC_KEY before running seed.ts");
  }

  const items = store("items");
  const photos = store("photos");

  for (const seed of SEED_ITEMS) {
    const now = new Date().toISOString();
    const item: Item = {
      id: randomUUID(),
      listNumber: seed.listNumber,
      title: seed.title,
      notes: seed.note ? [{ text: seed.note, author: "seed-script", at: now }] : [],
      category: seed.category,
      photos: [],
      coverPhotoId: null,
      comps: [],
      createdAt: now,
      updatedAt: now,
    };

    for (const filename of seed.photoFiles) {
      const filePath = join(PICS_DIR, filename);
      try {
        readFileSync(filePath); // just to fail fast with a clear error if missing
        await addPhoto(items, photos, item, filePath);
        console.log(`  + attached ${filename} to item #${seed.listNumber}`);
      } catch (err) {
        console.error(`  ! failed to attach ${filename} to item #${seed.listNumber}:`, err);
      }
    }

    await items.set(item.id, toArrayBuffer(encryptJson(item, item.id)), { metadata: { version: 1 } });
    console.log(`Seeded item #${seed.listNumber}: ${seed.title} (${item.photos.length} photo(s))`);
  }

  console.log("\nDone. Now open the site and verify every title/note against the original handwritten list.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
