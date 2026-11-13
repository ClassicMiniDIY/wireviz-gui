// readMultipartFormData returns Node Buffers typed as
// Buffer<ArrayBufferLike>. The DOM Blob constructor (TS 5.7+ lib) only
// accepts views over a plain ArrayBuffer, because a SharedArrayBuffer
// could change under it. h3 always allocates these Buffers over a plain
// ArrayBuffer, so narrow the type without copying the bytes.
export function asBlobPart(data: Buffer): Uint8Array<ArrayBuffer> {
  return data as Uint8Array<ArrayBuffer>
}
