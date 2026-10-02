import { describe, expect, it } from 'vitest'

import { MAX_REQUEST_BYTES, bodySizeError } from '../../server/utils/bodyLimit'

const API = '/api/wireviz/parse-multipart'

describe('bodySizeError', () => {
  it('allows a body at the limit', () => {
    expect(bodySizeError('POST', API, String(MAX_REQUEST_BYTES), undefined)).toBeNull()
  })

  it('refuses a body over the limit with 413', () => {
    expect(bodySizeError('POST', API, String(MAX_REQUEST_BYTES + 1), undefined)?.statusCode).toBe(413)
  })

  it('refuses chunked and length-less bodies with 411', () => {
    expect(bodySizeError('POST', API, undefined, 'chunked')?.statusCode).toBe(411)
    expect(bodySizeError('POST', API, '10', 'chunked')?.statusCode).toBe(411)
    expect(bodySizeError('POST', API, undefined, undefined)?.statusCode).toBe(411)
  })

  it('refuses a malformed Content-Length with 411', () => {
    for (const bad of ['-1', '1e9', 'abc', '', '99999999999999999999']) {
      expect(bodySizeError('POST', API, bad, undefined)?.statusCode).toBe(411)
    }
  })

  it('ignores other paths and body-less methods', () => {
    expect(bodySizeError('POST', '/api/other', undefined, undefined)).toBeNull()
    expect(bodySizeError('GET', '/api/wireviz/health', undefined, undefined)).toBeNull()
  })

  it('mirrors the sidecar limit', () => {
    // sidecar: MAX_YAML_BYTES + MAX_UPLOAD_BYTES + 1 MiB
    expect(MAX_REQUEST_BYTES).toBe(1_000_000 + 20 * 1024 * 1024 + 1024 * 1024)
  })
})
