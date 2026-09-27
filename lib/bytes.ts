// @netlify/blobs' Store.set() only accepts string | ArrayBuffer | Blob, not
// Node's Buffer (a Uint8Array subclass) despite them being byte-compatible.
export function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
