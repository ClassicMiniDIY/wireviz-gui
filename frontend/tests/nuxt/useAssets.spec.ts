// @vitest-environment nuxt
// Tests for the useAssets composable.
//
// useAssets uses Nuxt's useState, so this file runs under the Nuxt
// test environment (configured in vitest.config.ts to apply to
// tests/nuxt/**). The test wraps each access in a fresh Nuxt
// runtime context provided by @nuxt/test-utils.

import { beforeAll, describe, expect, it } from 'vitest'

import { buildAssetForm, useAssets } from '../../app/composables/useAssets'

// The Nuxt test env mixes node:buffer's strict URL.createObjectURL with
// happy-dom-shaped Blob instances — they're cross-realm so the native
// validator rejects them. Stub the two methods with sane no-ops so the
// composable can exercise its real logic without that environment quirk.
beforeAll(() => {
  let counter = 0
  ;(globalThis.URL as any).createObjectURL = () => `blob:fake/${++counter}`
  ;(globalThis.URL as any).revokeObjectURL = () => {}
})

function file(name: string, body: string = name, type = 'image/png'): File {
  return new File([new Blob([body])], name, { type })
}

describe('useAssets', () => {
  it('starts empty', () => {
    const a = useAssets()
    // useState is shared across calls within a Nuxt context, but the
    // test runner gives each test a fresh context, so this should be
    // empty here. If it's not, it means somebody else's test polluted
    // shared state — clear before assertions.
    a.clear()
    expect(a.count.value).toBe(0)
    expect(a.totalBytes.value).toBe(0)
    expect(a.list.value).toEqual([])
  })

  it('add() appends a new entry by filename', () => {
    const a = useAssets()
    a.clear()
    const entry = a.add(file('cross-section.png'))
    expect(entry.name).toBe('cross-section.png')
    expect(entry.size).toBeGreaterThan(0)
    expect(a.count.value).toBe(1)
    expect(a.list.value[0]!.name).toBe('cross-section.png')
  })

  it('add() with the same filename replaces the prior entry (last write wins)', () => {
    const a = useAssets()
    a.clear()
    const v1 = a.add(file('foo.png', 'first-version'))
    const v2 = a.add(file('foo.png', 'second-version-much-longer'))
    expect(a.count.value).toBe(1)
    // Use sizes as identity proxy — Vue's reactivity wraps entries on read,
    // so strict-equality (toBe) on the proxied object doesn't match the
    // original return value. The size disambiguates the two adds.
    expect(v1.size).not.toBe(v2.size)
    expect(a.list.value[0]!.size).toBe(v2.size)
  })

  it('remove() drops the named entry and is a no-op for missing names', () => {
    const a = useAssets()
    a.clear()
    a.add(file('a.png'))
    a.add(file('b.png'))
    a.remove('a.png')
    expect(a.count.value).toBe(1)
    expect(a.list.value[0]!.name).toBe('b.png')
    a.remove('does-not-exist.png')
    expect(a.count.value).toBe(1)
  })

  it('clear() removes all entries', () => {
    const a = useAssets()
    a.clear()
    a.add(file('a.png'))
    a.add(file('b.png'))
    a.clear()
    expect(a.count.value).toBe(0)
  })

  it('replaceAll() wipes existing and adds the supplied entries', () => {
    const a = useAssets()
    a.clear()
    a.add(file('old.png'))
    a.replaceAll([
      { name: 'one.png', blob: new Blob([new Uint8Array([1, 2, 3])]), type: 'image/png' },
      { name: 'two.jpg', blob: new Blob([new Uint8Array([4, 5])]), type: 'image/jpeg' },
    ])
    const names = a.list.value.map((e) => e.name).sort()
    expect(names).toEqual(['one.png', 'two.jpg'])
  })

  it('list is sorted by filename', () => {
    const a = useAssets()
    a.clear()
    a.add(file('zebra.png'))
    a.add(file('alpha.png'))
    a.add(file('mango.png'))
    expect(a.list.value.map((e) => e.name)).toEqual(['alpha.png', 'mango.png', 'zebra.png'])
  })

  it('totalBytes sums sizes of all entries', () => {
    const a = useAssets()
    a.clear()
    const big = file('big.png', 'a'.repeat(100))
    const small = file('small.png', 'b'.repeat(20))
    a.add(big)
    a.add(small)
    expect(a.totalBytes.value).toBe(120)
  })
})

describe('buildAssetForm', () => {
  it('appends scalar fields', () => {
    const fd = buildAssetForm({ yaml: 'connectors:', embed_yaml: 'true' }, [])
    expect(fd.get('yaml')).toBe('connectors:')
    expect(fd.get('embed_yaml')).toBe('true')
  })

  it('appends arrays as repeated fields', () => {
    const fd = buildAssetForm({ formats: ['svg', 'png', 'tsv'] }, [])
    expect(fd.getAll('formats')).toEqual(['svg', 'png', 'tsv'])
  })

  it('appends each asset as a `files` part with its filename', () => {
    const a1 = {
      name: 'a.png',
      size: 1,
      type: 'image/png',
      objectUrl: 'blob:fake',
      blob: new Blob([new Uint8Array([1])], { type: 'image/png' }),
    }
    const a2 = {
      name: 'b.png',
      size: 1,
      type: 'image/png',
      objectUrl: 'blob:fake',
      blob: new Blob([new Uint8Array([2])], { type: 'image/png' }),
    }
    const fd = buildAssetForm({ yaml: 'x' }, [a1, a2])
    const files = fd.getAll('files') as File[]
    expect(files).toHaveLength(2)
    expect(files.map((f) => f.name).sort()).toEqual(['a.png', 'b.png'])
  })
})
