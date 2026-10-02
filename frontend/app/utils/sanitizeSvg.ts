// Sanitize a WireViz SVG before it reaches `v-html`.
//
// The SVG is built from YAML that anyone can type or paste, and Graphviz
// copies some of that text into the SVG without escaping. The sidecar
// renders with `untrusted=True`, so the engine already strips script
// from its output. This is the second layer: the browser never inserts
// markup that DOMPurify's SVG profile has not cleaned.
//
// Embedded images are `<image xlink:href="data:image/...">`. DOMPurify
// keeps data: URIs on `<image>` by default (it is in DATA_URI_TAGS), so
// no extra hooks are needed. tests/unit/sanitizeSvg.spec.ts pins that.

import DOMPurify from 'dompurify'

export const SVG_PURIFY_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true },
}

/** Sanitize `svg` with a given DOMPurify instance (tests pass one bound
 * to a jsdom window). App code calls `sanitizeSvg`. */
export function sanitizeSvgWith(purify: typeof DOMPurify, svg: string): string {
  return purify.sanitize(svg, SVG_PURIFY_CONFIG)
}

/**
 * Return `svg` with scripts, event handlers and `javascript:` links
 * removed. DOMPurify needs a DOM, so on the server (SSR) this returns
 * an empty string: the caller renders nothing until the client runs.
 */
export function sanitizeSvg(svg: string): string {
  if (typeof window === 'undefined' || !DOMPurify.isSupported) return ''
  return sanitizeSvgWith(DOMPurify, svg)
}
