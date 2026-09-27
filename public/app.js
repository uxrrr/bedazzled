// Shared client-side helpers: authenticated fetch, image object-URL
// handling, and client-side photo resizing. ES module, no build step.
import { authHeaders } from "./identity.js";

export async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}), ...(await authHeaders()) };
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) {
    window.location.href = "/login.html";
    throw new Error("Unauthorized");
  }
  return res;
}

// Fetches a photo through the auth-gated function and returns an object URL.
// Caller is responsible for calling URL.revokeObjectURL(url) when done with it
// (e.g. on navigation away) since <img src> can't carry an auth header itself.
export async function fetchPhotoObjectUrl(blobId, mime) {
  const res = await apiFetch(`/.netlify/functions/photos-get?blobId=${encodeURIComponent(blobId)}&mime=${encodeURIComponent(mime)}`);
  if (!res.ok) throw new Error("Failed to load photo");
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// Thumbnails (gallery grid) can be tiny — appraisal detail doesn't matter there.
// Full images must stay detailed enough to judge hallmarks/inclusions/etc.,
// so they get a much looser cap than thumbnails, not the same 400KB target.
const THUMB_TARGET_BYTES = 100 * 1024;
const FULL_TARGET_BYTES = 1.5 * 1024 * 1024;

// Resizes an image File to fit within maxDim (long edge), then steps quality
// down (and if needed, dimensions too) until under targetBytes.
// Returns a base64 string (no data: prefix) and its mime type. Runs entirely
// client-side via canvas — deliberately not done server-side, to avoid
// pulling a native image library into the Netlify Functions runtime.
function resizeImage(file, maxDim, targetBytes) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        let dim = maxDim;
        let base64;

        // Shrink dimensions in a few steps if quality alone can't hit the target.
        for (let attempt = 0; attempt < 4; attempt++) {
          let { width, height } = img;
          if (width > height && width > dim) {
            height = Math.round((height * dim) / width);
            width = dim;
          } else if (height > dim) {
            width = Math.round((width * dim) / height);
            height = dim;
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          canvas.getContext("2d").drawImage(img, 0, 0, width, height);

          base64 = encodeUnderTarget(canvas, targetBytes);
          if (base64.byteLength <= targetBytes || dim <= 320) break;
          dim = Math.round(dim * 0.75);
        }

        resolve(base64.value);
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Steps JPEG quality down from 0.9 to ~0.5 until under targetBytes (or gives
// up and returns the smallest attempt), returning both the base64 string and
// its decoded byte length.
function encodeUnderTarget(canvas, targetBytes) {
  let best = null;
  for (let q = 0.9; q >= 0.5; q -= 0.1) {
    const dataUrl = canvas.toDataURL("image/jpeg", q);
    const value = dataUrl.split(",")[1];
    const byteLength = Math.round((value.length * 3) / 4); // approx decoded size
    best = { value, byteLength };
    if (byteLength <= targetBytes) break;
  }
  return best;
}

export async function uploadPhoto(itemId, file, etag) {
  const [fullBase64, thumbBase64] = await Promise.all([
    resizeImage(file, 2000, FULL_TARGET_BYTES),
    resizeImage(file, 320, THUMB_TARGET_BYTES),
  ]);
  const res = await apiFetch("/.netlify/functions/photos-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json", "If-Match": etag },
    body: JSON.stringify({ itemId, fullBase64, thumbBase64, mime: "image/jpeg" }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Upload failed");
  }
  const item = await res.json();
  return { item, etag: res.headers.get("ETag") };
}
