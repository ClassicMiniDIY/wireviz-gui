// Pack and unpack project bundles as plain .zip files.
//
// Bundle layout (flat):
//   harness.yml      ← required; YAML source at the root
//   <image>.png      ← any image files referenced by `image: src: foo.png`
//   <image>.jpg      ← etc.
//
// A flat layout means `image: src: foo.png` in the YAML resolves
// against the bundle root with no path rewriting on save. The
// importer is tolerant — it falls back to the first .yml/.yaml in
// the archive if `harness.yml` isn't there, and flattens nested
// image paths to their basenames so a hand-crafted zip with
// folders still works.
//
// We use JSZip entirely in-browser; no server round-trip is needed.

import JSZip from 'jszip'

import type { AssetEntry } from '~/composables/useAssets'

const HARNESS_FILENAME = 'harness.yml'

export type BundleContents = {
  yaml: string
  assets: { name: string; blob: Blob; type: string }[]
}

export function isProbablyYaml(name: string) {
  return /\.ya?ml$/i.test(name)
}

export function isProbablyImage(name: string) {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(name)
}

export function isProbablyZip(name: string, mime?: string) {
  return /\.zip$/i.test(name) || mime === 'application/zip'
}

function mimeForExt(name: string) {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  switch (ext) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'svg': return 'image/svg+xml'
    default: return 'application/octet-stream'
  }
}

export async function packBundle(yaml: string, assets: readonly AssetEntry[]): Promise<Blob> {
  const zip = new JSZip()
  zip.file(HARNESS_FILENAME, yaml)
  for (const a of assets) {
    zip.file(a.name, a.blob, { binary: true })
  }
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
}

export async function unpackBundle(file: Blob): Promise<BundleContents> {
  const zip = await JSZip.loadAsync(file)

  // Find the YAML file. Prefer harness.yml at the root; otherwise the
  // first .yml/.yaml in the bundle.
  let yamlName: string | undefined
  if (zip.files[HARNESS_FILENAME]) {
    yamlName = HARNESS_FILENAME
  } else {
    for (const name of Object.keys(zip.files)) {
      if (!zip.files[name]!.dir && isProbablyYaml(name)) {
        yamlName = name
        break
      }
    }
  }
  if (!yamlName) {
    throw new Error(
      'No .yml file found in the bundle. A project zip must contain harness.yml at its root.',
    )
  }

  const yaml = await zip.files[yamlName]!.async('string')

  const assets: BundleContents['assets'] = []
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || name === yamlName) continue
    if (!isProbablyImage(name)) continue
    const flat = name.split('/').pop()!
    const blob = await entry.async('blob')
    assets.push({
      name: flat,
      blob: new Blob([blob], { type: mimeForExt(flat) }),
      type: mimeForExt(flat),
    })
  }

  return { yaml, assets }
}
