// Request size limit for the /api/wireviz/* proxy routes.
//
// The proxies read the whole body into memory (readBody /
// readMultipartFormData) before they forward it, so the sidecar's own
// 413 checks run too late to protect this process. This check runs first,
// in server/middleware/body-limit.ts, on the declared Content-Length.
// Node's HTTP parser never delivers more bytes than Content-Length, so the
// declared value is a real bound. Requests without one (chunked) are
// refused: browsers always send Content-Length for FormData and JSON.

// Mirrors the sidecar's MAX_REQUEST_BYTES (1 MB YAML + 20 MiB uploads
// + 1 MiB of multipart overhead), see sidecar/wireviz_gui_sidecar/app.py.
export const MAX_REQUEST_BYTES = 1_000_000 + 21 * 1024 * 1024

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH'])

export interface BodySizeError {
  statusCode: 411 | 413
  detail: string
}

export function bodySizeError(
  method: string,
  path: string,
  contentLength: string | undefined,
  transferEncoding: string | undefined,
  maxBytes: number = MAX_REQUEST_BYTES,
): BodySizeError | null {
  if (!path.startsWith('/api/wireviz/') || !BODY_METHODS.has(method.toUpperCase())) {
    return null
  }
  if (transferEncoding || contentLength === undefined) {
    return { statusCode: 411, detail: 'Request must have a Content-Length header' }
  }
  const length = /^\d+$/.test(contentLength.trim()) ? Number(contentLength) : NaN
  if (!Number.isSafeInteger(length)) {
    return { statusCode: 411, detail: 'Request has an invalid Content-Length header' }
  }
  if (length > maxBytes) {
    return {
      statusCode: 413,
      detail: `Request body is larger than the limit of ${maxBytes} bytes`,
    }
  }
  return null
}
