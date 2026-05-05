// Tests for the templates module.
//
// These guard the contract that every Templates ▾ entry can actually
// load: the YAML is well-formed, ids are unique, and any bundled
// asset URL points at a file we ship.

import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import yaml from 'js-yaml'

import { getTemplate, wirevizTemplates } from '../../app/templates/wireviz'

const FRONTEND_ROOT = resolve(__dirname, '../..')

describe('wirevizTemplates', () => {
  it('has at least the core set of templates', () => {
    expect(wirevizTemplates.length).toBeGreaterThanOrEqual(5)
    const ids = wirevizTemplates.map((t) => t.id)
    // A handful of stable picks we want to keep around.
    for (const id of ['blank', 'simple-cable', 'shielded-rs232']) {
      expect(ids).toContain(id)
    }
  })

  it('every template has the required fields', () => {
    for (const t of wirevizTemplates) {
      expect(t.id).toMatch(/^[a-z0-9-]+$/)
      expect(t.name.length).toBeGreaterThan(0)
      expect(t.description.length).toBeGreaterThan(0)
      expect(t.yaml.length).toBeGreaterThan(0)
    }
  })

  it('template ids are unique', () => {
    const ids = wirevizTemplates.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every template’s YAML parses as valid YAML', () => {
    for (const t of wirevizTemplates) {
      // Just needs to parse — we don't validate against the WireViz schema
      // here because the sidecar smoke tests already exercise that path
      // for at least the BWTM subset.
      expect(() => yaml.load(t.yaml), `template ${t.id}`).not.toThrow()
    }
  })

  it('templates that declare assets point at files we ship', () => {
    for (const t of wirevizTemplates) {
      if (!t.assets?.length) continue
      for (const a of t.assets) {
        expect(a.name.length, `template ${t.id} asset name`).toBeGreaterThan(0)
        expect(a.url.startsWith('/'), `template ${t.id} asset url`).toBe(true)
        // The URL is browser-relative; on disk it lives under public/<path>.
        const onDisk = resolve(FRONTEND_ROOT, 'public', a.url.replace(/^\//, ''))
        expect(existsSync(onDisk), `${t.id} → ${a.url} (${onDisk})`).toBe(true)
      }
    }
  })

  it('template asset names referenced in the YAML are bundled', () => {
    // If the YAML mentions `image: src: foo.png`, then the template's
    // assets array must include an entry named "foo.png" — otherwise
    // the user would get a missing-asset render error on load.
    for (const t of wirevizTemplates) {
      const referenced = [...t.yaml.matchAll(/\bsrc:\s*([^\s]+)/g)].map((m) => m[1]!)
      if (referenced.length === 0) continue
      const provided = new Set(t.assets?.map((a) => a.name) ?? [])
      for (const ref of referenced) {
        // Skip absolute or URL-style paths — those wouldn't go through
        // image_paths anyway. We only enforce the contract for plain
        // basenames the engine resolves against the upload tempdir.
        if (ref.includes('/') || ref.includes('://')) continue
        expect(provided.has(ref), `template ${t.id} references ${ref} but didn't bundle it`).toBe(true)
      }
    }
  })

  it('getTemplate returns by id and undefined for misses', () => {
    expect(getTemplate('blank')?.id).toBe('blank')
    expect(getTemplate('does-not-exist')).toBeUndefined()
  })
})
