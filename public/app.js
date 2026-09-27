// Shared client-side helpers: authenticated fetch, image object-URL
// handling, and client-side photo resizing. ES module, no build step.
import { authHeaders } from "./identity.js";

export function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

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

