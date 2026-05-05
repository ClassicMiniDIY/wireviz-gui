// Pack and unpack the .wvz project bundle.
//
// Bundle format: a flat zip containing:
//   - harness.yml   (the YAML source at the bundle root)
//   - <image>.png   (any image files referenced by `image: src: foo.png`)
//   - <image>.jpg   (etc — any non-yaml binary at the root is treated as
//                   an asset)
//
// Flat layout was chosen so that `image: src: foo.png` in the YAML
// resolves against the bundle root without rewriting paths on save.
//
// We use JSZip in-browser; no server round-trip is needed for pack/unpack.
// Packing is sync (kicked off on click); unpacking is async because reading
// each entry's blob is async.

import JSZip from 'jszip'

import type { AssetEntry } from '~/composables/useAssets'

const HARNESS_FILENAME = 'harness.yml'

export type WvzContents = {
  yaml: string
  assets: { name: string; blob: Blob; type: string }[]
}

export function isProbablyYaml(name: string) {
  return /\.ya?ml$/i.test(name)
}

export function isProbablyImage(name: string) {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(name)
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

export async function unpackBundle(file: Blob): Promise<WvzContents> {
  const zip = await JSZip.loadAsync(file)

  // Find the YAML file. Prefer harness.yml at the root; otherwise the
  // first .yml/.yaml in the bundle. This makes us tolerant of zips that
  // someone hand-crafted without strictly following our naming.
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
      'No .yml file found in the bundle. A .wvz must contain harness.yml at its root.',
    )
  }

  const yaml = await zip.files[yamlName]!.async('string')

  // Everything else that looks like an image becomes an asset, keyed by
  // its filename (without the directory prefix, in case someone zipped
  // with nested paths — we flatten on import).
  const assets: WvzContents['assets'] = []
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
