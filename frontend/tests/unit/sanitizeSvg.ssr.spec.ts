// @vitest-environment node
//
// SSR guard for sanitizeSvg: on the server there is no DOM, so DOMPurify
// cannot run. The function must fail closed (return '') rather than throw
// or pass the raw SVG through.

import { describe, expect, it } from 'vitest'

import { sanitizeSvg } from '../../app/utils/sanitizeSvg'

describe('sanitizeSvg without a DOM (SSR)', () => {
  it('returns an empty string instead of the raw SVG', () => {
    expect(typeof window).toBe('undefined')
    expect(sanitizeSvg('<svg onload="alert(1)"></svg>')).toBe('')
  })
})
