// Reactive store for image assets attached to the current harness.
//
// Keyed by filename so the YAML's `image: src: foo.png` references map
// directly into the upload set. Adding the same filename twice replaces
// the prior version (last write wins) — the user expectation when
// dropping an updated copy of the same asset.
//
// Survives across component re-renders via Nuxt's useState — putting it
// in a composable rather than the page lets future routes (a project
// browser, batch-render UI, etc.) share the same asset state.

import { computed, readonly } from 'vue'

export type AssetEntry = {
  name: string
  size: number
  type: string
  /** Cached object URL for thumbnail rendering. Revoked when the asset is removed. */
  objectUrl: string
  blob: Blob
}

export function useAssets() {
  const map = useState<Map<string, AssetEntry>>('cmdiy-wvz-assets', () => new Map())

  function add(file: File | { name: string; type?: string; data: Blob }): AssetEntry {
    const name = (file as File).name ?? (file as any).name
    const blob = file instanceof File ? file : (file as any).data
    const type = (file as any).type ?? blob.type ?? 'application/octet-stream'
    const existing = map.value.get(name)
    if (existing) URL.revokeObjectURL(existing.objectUrl)
    const entry: AssetEntry = {
      name,
      size: blob.size,
      type,
      objectUrl: URL.createObjectURL(blob),
      blob,
    }
    // Re-create the Map so Vue picks up the change (Map mutations aren't
    // reactive on their own).
    const next = new Map(map.value)
    next.set(name, entry)
    map.value = next
    return entry
  }

  function remove(name: string) {
    const entry = map.value.get(name)
    if (!entry) return
    URL.revokeObjectURL(entry.objectUrl)
    const next = new Map(map.value)
    next.delete(name)
    map.value = next
  }

  function clear() {
    for (const entry of map.value.values()) URL.revokeObjectURL(entry.objectUrl)
    map.value = new Map()
  }

  /** Replace the entire asset set in one go (used by the .wvz import path). */
  function replaceAll(entries: { name: string; blob: Blob; type?: string }[]) {
    clear()
    for (const e of entries) {
      add({ name: e.name, type: e.type ?? e.blob.type, data: e.blob })
    }
  }

  const list = computed(() => [...map.value.values()].sort((a, b) => a.name.localeCompare(b.name)))
  const count = computed(() => map.value.size)
  const totalBytes = computed(() => list.value.reduce((n, e) => n + e.size, 0))

  return {
    list: readonly(list),
    count,
    totalBytes,
    add,
    remove,
    clear,
    replaceAll,
    /** Direct access to the underlying map for the multipart-form builder. */
    raw: readonly(map),
  }
}

/**
 * Build a FormData payload that the sidecar's multipart endpoints expect.
 * Caller passes the YAML and any extra form fields; we append all assets
 * as repeated `files` parts. The sidecar reads `files: list[UploadFile]`
 * out of these.
 */
export function buildAssetForm(
  fields: Record<string, string | string[]>,
  assets: readonly AssetEntry[],
): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) {
      for (const item of v) fd.append(k, item)
    } else {
      fd.append(k, v)
    }
  }
  for (const a of assets) {
    fd.append('files', a.blob, a.name)
  }
  return fd
}
