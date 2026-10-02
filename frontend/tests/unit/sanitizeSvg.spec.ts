// Tests for sanitizeSvg — the last check before a rendered SVG goes
// into `v-html` in app.vue.
//
// DOMPurify runs here on a jsdom window, not on the happy-dom globals of
// this test environment. DOMPurify needs a faithful DOM: under happy-dom
// 20 it drops the <svg> root and leaves xlink:href="javascript:..." in
// place (happy-dom's removeAttribute does not remove namespaced
// attributes), so a happy-dom pass proves nothing about real browsers.
// jsdom is the DOM DOMPurify itself tests against. The SSR guard is
// covered in sanitizeSvg.ssr.spec.ts (node environment).

import createDOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import { sanitizeSvgWith } from '../../app/utils/sanitizeSvg'

const { window: jsdomWindow } = new JSDOM('')
const purify = createDOMPurify(jsdomWindow as unknown as Window & typeof globalThis)
const sanitizeSvg = (svg: string) => sanitizeSvgWith(purify, svg)

const PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAADElEQVR4nGNgoBwAAABEAAHX40j9AAAAAElFTkSuQmCC'

// Shape of a real WireViz SVG (XML prolog, xlink namespace, Graphviz
// groups, an embedded image) with script vectors mixed in.
const DIRTY_SVG = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="551pt" height="291pt" viewBox="0.00 0.00 551.00 291.00" onload="alert('root')">
<script>alert('script')</script>
<g id="graph0" class="graph" transform="scale(1 1) rotate(0) translate(4 287.25)">
<g id="node1" class="node">
<title>X1</title>
<polygon fill="#ffffff" stroke="black" points="0,0 0,-108 108,-108 108,0 0,0" />
<text text-anchor="start" x="8" y="-20" font-family="x" onclick="alert('click')" font-size="14.00">X1</text>
<image xlink:href="${PNG_DATA_URI}" width="96px" height="96px" preserveAspectRatio="xMinYMin meet" x="6" y="-102" />
<a xlink:href="javascript:alert('xlink')"><text x="0" y="0">xlink link</text></a>
<a href="javascript:alert('href')"><text x="0" y="0">href link</text></a>
<foreignObject width="10" height="10"><div onmouseover="alert('fo')">fo</div></foreignObject>
</g>
</g>
</svg>
`

describe('sanitizeSvg', () => {
  const clean = sanitizeSvg(DIRTY_SVG)
  const lowered = clean.toLowerCase()

  it('keeps the SVG and its Graphviz structure', () => {
    expect(clean).toContain('<svg')
    expect(clean).toContain('<polygon')
    expect(clean).toContain('<title>X1</title>')
    expect(clean).toContain('viewBox="0.00 0.00 551.00 291.00"')
  })

  it('removes <script> elements', () => {
    expect(lowered).not.toContain('<script')
    expect(lowered).not.toContain("alert('script')")
  })

  it('removes on* event handler attributes', () => {
    expect(lowered).not.toContain('onload')
    expect(lowered).not.toContain('onclick')
    expect(lowered).not.toContain('onmouseover')
  })

  it('removes javascript: links (href and xlink:href)', () => {
    expect(lowered).not.toContain('javascript:')
    // The link text stays; only the dangerous attribute goes.
    expect(clean).toContain('xlink link')
  })

  it('removes <foreignObject>', () => {
    expect(lowered).not.toContain('foreignobject')
  })

  it('keeps an embedded data:image/png <image>', () => {
    const doc = new jsdomWindow.DOMParser().parseFromString(
      `<div>${clean}</div>`,
      'text/html',
    )
    const image = doc.querySelector('image')
    expect(image).not.toBeNull()
    const href =
      image!.getAttribute('xlink:href') ?? image!.getAttribute('href')
    expect(href).toBe(PNG_DATA_URI)
  })

  it('removes <image> with a non-data href', () => {
    const out = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="javascript:alert(1)" /></svg>',
    )
    expect(out.toLowerCase()).not.toContain('javascript:')
  })

  it('returns an empty string for an empty input', () => {
    expect(sanitizeSvg('')).toBe('')
  })
})
