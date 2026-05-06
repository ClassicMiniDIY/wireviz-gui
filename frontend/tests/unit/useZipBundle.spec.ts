// Tests for the .zip project-bundle pack/unpack composable.
//
// Verifies the format contract documented in CLAUDE.md:
//   - flat zip, harness.yml at root, image siblings
//   - tolerant import (falls back to first .yml/.yaml; flattens nested paths)
//   - round-trip equality
//
// These are pure functions — no Nuxt context needed.

import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import {
  isProbablyImage,
  isProbablyYaml,
  isProbablyZip,
  packBundle,
  unpackBundle,
} from '../../app/composables/useZipBundle'

const SAMPLE_YAML = `connectors:
  X1:
    pincount: 4
cables:
  W1:
    wirecount: 4
    length: 1
connections:
  -
    - X1: [1-4]
    - W1: [1-4]
`

function pngBlob(byte: number = 0): Blob {
  // Minimal PNG-ish blob — content doesn't have to be a valid PNG for
  // pack/unpack tests, only the round-trip equality check cares.
  return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, byte])], { type: 'image/png' })
}

function asset(name: string, blob: Blob = pngBlob()) {
  return {
    name,
    size: blob.size,
    type: blob.type,
    objectUrl: 'blob:fake',
    blob,
  }
}

describe('useZipBundle predicates', () => {
  it('classifies YAML extensions', () => {
    expect(isProbablyYaml('foo.yml')).toBe(true)
    expect(isProbablyYaml('foo.yaml')).toBe(true)
    expect(isProbablyYaml('FOO.YML')).toBe(true)
    expect(isProbablyYaml('foo.json')).toBe(false)
    expect(isProbablyYaml('yaml')).toBe(false)
  })

  it('classifies image extensions', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']) {
      expect(isProbablyImage(`foo.${ext}`)).toBe(true)
      expect(isProbablyImage(`foo.${ext.toUpperCase()}`)).toBe(true)
    }
    expect(isProbablyImage('foo.bmp')).toBe(false)
    expect(isProbablyImage('foo')).toBe(false)
  })

  it('classifies zip files by extension or mime', () => {
    expect(isProbablyZip('project.zip')).toBe(true)
    expect(isProbablyZip('PROJECT.ZIP')).toBe(true)
    expect(isProbablyZip('project', 'application/zip')).toBe(true)
    expect(isProbablyZip('foo.png', 'image/png')).toBe(false)
    expect(isProbablyZip('foo.png')).toBe(false)
  })
})

describe('packBundle', () => {
  it('produces a real zip with harness.yml at the root', async () => {
    const blob = await packBundle(SAMPLE_YAML, [])
    expect(blob.type).toBe('application/zip')

    // Parse it back with JSZip directly to verify the layout — proves
    // we don't need our own unpacker to read the output.
    const zip = await JSZip.loadAsync(blob)
    expect(zip.files['harness.yml']).toBeTruthy()
    const yaml = await zip.files['harness.yml']!.async('string')
    expect(yaml).toBe(SAMPLE_YAML)
  })

  it('includes every asset at the root, by basename', async () => {
    const blob = await packBundle(SAMPLE_YAML, [
      asset('cross-section.png'),
      asset('connector-detail.jpg', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })),
    ])
    const zip = await JSZip.loadAsync(blob)
    expect(Object.keys(zip.files).sort()).toEqual([
      'connector-detail.jpg',
      'cross-section.png',
      'harness.yml',
    ])
  })
})

describe('unpackBundle', () => {
  async function makeZip(entries: Record<string, string | Uint8Array>): Promise<Blob> {
    const zip = new JSZip()
    for (const [name, content] of Object.entries(entries)) {
      zip.file(name, content)
    }
    return zip.generateAsync({ type: 'blob' })
  }

  it('reads harness.yml + image siblings', async () => {
    const zip = await makeZip({
      'harness.yml': SAMPLE_YAML,
      'cross-section.png': new Uint8Array([0x89, 0x50]),
      'detail.jpg': new Uint8Array([0xff, 0xd8]),
    })
    const result = await unpackBundle(zip)
    expect(result.yaml).toBe(SAMPLE_YAML)
    expect(result.assets.map((a) => a.name).sort()).toEqual(['cross-section.png', 'detail.jpg'])
    expect(result.assets.find((a) => a.name === 'cross-section.png')!.type).toBe('image/png')
    expect(result.assets.find((a) => a.name === 'detail.jpg')!.type).toBe('image/jpeg')
  })

  it('falls back to the first .yml/.yaml when no harness.yml is present', async () => {
    const zip = await makeZip({
      'wiring.yaml': SAMPLE_YAML,
      'foo.png': new Uint8Array([0]),
    })
    const result = await unpackBundle(zip)
    expect(result.yaml).toBe(SAMPLE_YAML)
    expect(result.assets).toHaveLength(1)
  })

  it('flattens nested image paths to basenames', async () => {
    const zip = await makeZip({
      'harness.yml': SAMPLE_YAML,
      'images/sub/cross-section.png': new Uint8Array([1, 2]),
    })
    const result = await unpackBundle(zip)
    expect(result.assets[0]!.name).toBe('cross-section.png')
  })

  it('ignores entries that are neither YAML nor recognised images', async () => {
    const zip = await makeZip({
      'harness.yml': SAMPLE_YAML,
      'README.md': '# notes',
      'extra.json': '{}',
    })
    const result = await unpackBundle(zip)
    expect(result.assets).toHaveLength(0)
  })

  it('throws when no YAML file is present', async () => {
    const zip = await makeZip({ 'cross-section.png': new Uint8Array([0]) })
    await expect(unpackBundle(zip)).rejects.toThrow(/harness\.yml/)
  })
})

describe('pack ↔ unpack round-trip', () => {
  it('preserves YAML and asset bytes exactly', async () => {
    const blob = pngBlob(0xab)
    const original = asset('cross-section.png', blob)
    const bundle = await packBundle(SAMPLE_YAML, [original])
    const result = await unpackBundle(bundle)

    expect(result.yaml).toBe(SAMPLE_YAML)
    expect(result.assets).toHaveLength(1)
    expect(result.assets[0]!.name).toBe('cross-section.png')

    // Verify the asset bytes survive round-trip byte-for-byte.
    const originalBytes = new Uint8Array(await blob.arrayBuffer())
    const roundTripBytes = new Uint8Array(await result.assets[0]!.blob.arrayBuffer())
    expect(roundTripBytes).toEqual(originalBytes)
  })
})
