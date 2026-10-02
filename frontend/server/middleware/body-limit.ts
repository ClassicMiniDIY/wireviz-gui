// Refuses oversize /api/wireviz/* requests before a proxy route reads the
// body into memory. See server/utils/bodyLimit.ts.

import { bodySizeError } from '../utils/bodyLimit'

export default defineEventHandler((event) => {
  const error = bodySizeError(
    event.method,
    event.path,
    getRequestHeader(event, 'content-length'),
    getRequestHeader(event, 'transfer-encoding'),
  )
  if (error) {
    // `data.detail` is what the editor UI shows (same shape as sidecar errors).
    throw createError({
      statusCode: error.statusCode,
      statusMessage: error.statusCode === 413 ? 'Payload Too Large' : 'Length Required',
      data: { detail: error.detail },
    })
  }
})
