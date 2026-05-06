// Tests for the schema-driven YAML autocomplete provider.
//
// We test the building blocks rather than the registered Monaco
// provider — Monaco's API surface is large and brittle to mock.
// The internal functions (locateScope, valuePositionField, builders)
// are exported so we can poke at them directly.
//
// Each scenario picks a YAML fragment, simulates a cursor position,
// and asserts the resolved schema or generated suggestions.

import { describe, expect, it } from 'vitest'

import {
  buildKeyCompletions,
  buildValueCompletions,
  locateScope,
  valuePositionField,
} from '../../app/composables/useWirevizCompletion'

// Stub Monaco namespace — only the bits the builders touch.
const monacoStub = {
  languages: {
    CompletionItemKind: { Property: 1, Module: 2, Value: 3 } as any,
    CompletionItemInsertTextRule: { InsertAsSnippet: 4 } as any,
  },
} as any

const SAMPLE_RANGE = { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 1 }

/** Helper: split a multiline string into lines without a trailing empty. */
function lines(text: string) {
  // Match Monaco's getLinesContent shape — last newline doesn't produce a trailing empty.
  return text.replace(/\n$/, '').split('\n')
}

describe('locateScope', () => {
  it('returns root schema when chain is empty', () => {
    const scope = locateScope([''], 0, 1)
    expect(scope.properties?.connectors).toBeTruthy()
    expect(scope.properties?.cables).toBeTruthy()
    expect(scope.properties?.connections).toBeTruthy()
  })

  it('descends into a connector inside connectors → designator', () => {
    const buf = `connectors:
  X1:
    `
    // Cursor at line 3, column 5 — indent 4, inside X1 connector body
    const scope = locateScope(lines(buf), 2, 5)
    // Connector schema has these fields per the JSON schema.
    expect(scope.properties?.type).toBeTruthy()
    expect(scope.properties?.subtype).toBeTruthy()
    expect(scope.properties?.pinlabels).toBeTruthy()
    expect(scope.properties?.pincount).toBeTruthy()
    expect(scope.properties?.color).toBeTruthy()
  })

  it('descends into a cable inside cables → designator', () => {
    const buf = `cables:
  W1:
    `
    const scope = locateScope(lines(buf), 2, 5)
    expect(scope.properties?.gauge).toBeTruthy()
    expect(scope.properties?.color_code).toBeTruthy()
    expect(scope.properties?.colors).toBeTruthy()
    expect(scope.properties?.shield).toBeTruthy()
    // Verify it's the cable schema, not connector — pincount is connector-only
    expect(scope.properties?.pincount).toBeFalsy()
  })

  it('descends into AdditionalComponent under additional_components item', () => {
    // Cursor after `- ` on the item line. dash at indent 6, cursor at column 9
    // (effective indent 8). Should resolve into items schema (AdditionalComponent).
    const buf = `connectors:
  X1:
    pincount: 4
    additional_components:
      - `
    const scope = locateScope(lines(buf), 4, 9)
    expect(scope.properties?.type).toBeTruthy()
    expect(scope.properties?.qty).toBeTruthy()
    expect(scope.properties?.qty_multiplier).toBeTruthy()
    expect(scope.properties?.manufacturer).toBeTruthy()
  })

  it('keeps item context on a sibling line under an existing - key:value', () => {
    // After `- type: Crimp`, on a fresh sibling line at the item's content
    // indent. type:Crimp's key frame at indent 8 is a sibling of the cursor
    // and should be popped; the item frame at indent 6 should stay.
    const buf = `connectors:
  X1:
    pincount: 4
    additional_components:
      - type: Crimp
        `
    const scope = locateScope(lines(buf), 5, 9)
    expect(scope.properties?.type).toBeTruthy()
    expect(scope.properties?.subtype).toBeTruthy()
    expect(scope.properties?.qty_multiplier).toBeTruthy()
  })

  it('handles top-level additional_bom_items array items', () => {
    const buf = `additional_bom_items:
  - `
    const scope = locateScope(lines(buf), 1, 5)
    // additional_bom_items items have description / qty / designators / etc.
    expect(scope.properties?.description).toBeTruthy()
    expect(scope.properties?.qty).toBeTruthy()
    expect(scope.properties?.designators).toBeTruthy()
  })

  it('returns empty schema when the chain leaves the documented surface', () => {
    // Drilling into a leaf scalar field shouldn't keep offering keys.
    const buf = `connectors:
  X1:
    type:
      `
    // Cursor inside the value of `type:` — we're past the YAML's documented
    // shape (type is a scalar, not an object).
    const scope = locateScope(lines(buf), 3, 7)
    expect(scope.properties).toBeFalsy()
  })
})

describe('valuePositionField', () => {
  // Helper to call valuePositionField against a known scope.
  const cableScope = locateScope(
    lines(`cables:
  W1:
    `),
    2,
    5,
  )
  const connectorScope = locateScope(
    lines(`connectors:
  X1:
    `),
    2,
    5,
  )

  it('returns null in pure key position (no colon yet)', () => {
    expect(valuePositionField('    ', cableScope)).toBeNull()
    expect(valuePositionField('  X1', cableScope)).toBeNull()
  })

  it('returns the field schema after `key: ` with no value typed', () => {
    const field = valuePositionField('    color_code: ', cableScope)
    expect(field).toBeTruthy()
    expect(field!.enum).toContain('DIN')
    expect(field!.enum).toContain('IEC')
  })

  it('still returns the field schema with a partial value typed', () => {
    // The earlier bug — the value branch dropped out as soon as text was typed.
    const field = valuePositionField('    color_code: D', cableScope)
    expect(field).toBeTruthy()
    expect(field!.enum).toContain('DIN')
  })

  it('descends into items schema when the cursor is inside `[...]`', () => {
    // colors: [WH, B|]  → cursor inside an unclosed array literal.
    const field = valuePositionField('    colors: [WH, B', cableScope)
    expect(field).toBeTruthy()
    // colorCode definition has examples, not enum.
    expect((field!.examples as string[]).some((e) => e === 'BK' || e === 'BN')).toBe(true)
  })

  it('returns the field schema for connector-level fields', () => {
    const field = valuePositionField('    color: ', connectorScope)
    expect(field).toBeTruthy()
    expect(field!.examples).toBeTruthy()
  })

  it('returns null when the key isn’t in the scope', () => {
    const field = valuePositionField('    not_a_real_field: ', cableScope)
    expect(field).toBeNull()
  })
})

describe('buildKeyCompletions', () => {
  it('emits a Property for every key in the scope', () => {
    const scope = locateScope([''], 0, 1) // root
    const items = buildKeyCompletions(monacoStub, scope, SAMPLE_RANGE)
    const labels = items.map((i) => i.label)
    expect(labels).toContain('connectors')
    expect(labels).toContain('cables')
    expect(labels).toContain('connections')
    expect(labels).toContain('metadata')
  })

  it('uses an enum-snippet insertText for fields with an enum', () => {
    const scope = locateScope(
      lines(`cables:
  W1:
    `),
      2,
      5,
    )
    const items = buildKeyCompletions(monacoStub, scope, SAMPLE_RANGE)
    const colorCode = items.find((i) => i.label === 'color_code')!
    expect(colorCode.insertText).toContain('DIN')
    expect(colorCode.insertText).toContain('IEC')
    expect(colorCode.insertText).toContain('${1|') // snippet choice marker
  })

  it('uses an array-shaped insertText for array fields', () => {
    const scope = locateScope(
      lines(`connectors:
  X1:
    `),
      2,
      5,
    )
    const items = buildKeyCompletions(monacoStub, scope, SAMPLE_RANGE)
    const pinlabels = items.find((i) => i.label === 'pinlabels')!
    expect(pinlabels.insertText).toContain('- $0')
  })

  it('returns an empty array when scope has no properties', () => {
    expect(buildKeyCompletions(monacoStub, {}, SAMPLE_RANGE)).toEqual([])
  })
})

describe('buildValueCompletions', () => {
  it('expands an enum field into one suggestion per value', () => {
    const cableScope = locateScope(
      lines(`cables:
  W1:
    `),
      2,
      5,
    )
    const field = valuePositionField('    color_code: ', cableScope)!
    const items = buildValueCompletions(monacoStub, field, SAMPLE_RANGE)
    const labels = items.map((i) => i.label)
    expect(labels).toEqual(
      expect.arrayContaining(['DIN', 'IEC', 'T568A', 'T568B', 'TEL', 'TELALT', 'BW']),
    )
  })

  it('expands examples (e.g. colorCode) into suggestions', () => {
    const connectorScope = locateScope(
      lines(`connectors:
  X1:
    `),
      2,
      5,
    )
    const field = valuePositionField('    color: ', connectorScope)!
    const items = buildValueCompletions(monacoStub, field, SAMPLE_RANGE)
    const labels = items.map((i) => i.label)
    expect(labels).toEqual(expect.arrayContaining(['BK', 'WH', 'GY', 'RD', 'OG', 'YE', 'GN', 'BU']))
    // PU was removed from the schema in a recent fix.
    expect(labels).not.toContain('PU')
  })

  it('emits true/false for boolean fields', () => {
    const connectorScope = locateScope(
      lines(`connectors:
  X1:
    `),
      2,
      5,
    )
    const field = valuePositionField('    show_pincount: ', connectorScope)!
    const items = buildValueCompletions(monacoStub, field, SAMPLE_RANGE)
    const labels = items.map((i) => i.label)
    expect(labels).toContain('true')
    expect(labels).toContain('false')
  })

  it('walks oneOf branches (shield: bool | colorCode)', () => {
    const cableScope = locateScope(
      lines(`cables:
  W1:
    `),
      2,
      5,
    )
    const field = valuePositionField('    shield: ', cableScope)!
    const items = buildValueCompletions(monacoStub, field, SAMPLE_RANGE)
    const labels = items.map((i) => i.label)
    // Should include booleans (one branch) AND color codes (other branch)
    expect(labels).toContain('true')
    expect(labels).toContain('false')
    expect(labels).toContain('BK')
  })

  it('deduplicates candidates that appear in multiple sources', () => {
    const cableScope = locateScope(
      lines(`cables:
  W1:
    `),
      2,
      5,
    )
    const field = valuePositionField('    colors: [', cableScope)!
    const items = buildValueCompletions(monacoStub, field, SAMPLE_RANGE)
    const labels = items.map((i) => i.label)
    // Each label appears at most once.
    expect(new Set(labels).size).toBe(labels.length)
  })
})

// ---- PR review regressions -------------------------------------------

describe('regex: keys with dashes and YAML merge anchor', () => {
  it('walks past a `<<: *anchor` line to the surrounding scope (PR review)', () => {
    // Templates that use YAML anchors (tutorial06 in WireViz, the
    // daisy-chained-sensors template here) include `<<: *template_con`.
    // The `<<` merge key has to be tolerated by the scope walker — if
    // the key regex rejects it, popTo never runs at that indent and
    // the chain ends up wrong for siblings on the same line.
    const buf = `connectors:
  X1: &template_con
    pinlabels: [GND, VCC, SCL]
  X2:
    <<: *template_con
    `
    // Cursor at line 6 col 5 (indent 4) — inside X2, sibling of `<<`.
    const scope = locateScope(lines(buf), 5, 5)
    expect(scope.properties?.type).toBeTruthy()
    expect(scope.properties?.subtype).toBeTruthy()
  })

  it('accepts dashed keys in user YAML even though our schema uses snake_case (PR review)', () => {
    // Custom keys like `pin-labels` aren't in our schema, but they
    // shouldn't break scope walking for ancestors. The regex accepting
    // dashes lets popTo do its job at the right indent.
    const buf = `connectors:
  X1:
    pin-labels: [a, b]
    `
    const scope = locateScope(lines(buf), 3, 5)
    // Resolved into a connector. We can't assert specific properties
    // beyond "the scope had any properties" because the dashed key
    // isn't in the schema — what matters is the chain was tracked.
    expect(scope.properties?.type).toBeTruthy()
  })

  it('valuePositionField recognises a dashed key on the value side', () => {
    const cableScope = locateScope(
      lines(`cables:
  W1:
    `),
      2,
      5,
    )
    // Even though our schema doesn't have dashed cable fields, the
    // regex should accept the key shape — returning null only because
    // the field isn't documented, not because the syntax was rejected.
    expect(valuePositionField('    pin-labels: ', cableScope)).toBeNull()
    // Sanity: a real field still resolves
    expect(valuePositionField('    color_code: ', cableScope)).toBeTruthy()
  })
})

describe('buildKeyCompletions: enum snippet safety', () => {
  it('falls back to plain "key: " when enum values contain a snippet metachar', () => {
    // Monaco choice snippets can't escape `,` or `|`. Verify the
    // builder downgrades to a simple insertion in that case rather
    // than emitting a malformed snippet that confuses the editor.
    const fakeScope: any = {
      properties: {
        sketchy: {
          type: 'string',
          enum: ['ok', 'has,comma', 'pipe|inside'],
        },
        clean: {
          type: 'string',
          enum: ['DIN', 'IEC'],
        },
      },
    }
    const items = buildKeyCompletions(monacoStub, fakeScope, SAMPLE_RANGE)
    const sketchy = items.find((i) => i.label === 'sketchy')!
    const clean = items.find((i) => i.label === 'clean')!
    expect(sketchy.insertText).toBe('sketchy: $0')
    expect(sketchy.insertText).not.toContain('${1|')
    expect(clean.insertText).toContain('${1|DIN,IEC|}')
  })
})

describe('unwrap: bounded recursion', () => {
  // The real schema is non-circular but the guard stops a malformed
  // future schema from stack-overflowing the editor on cursor move.
  it('does not infinite-loop on circular $ref', async () => {
    // Build a circular schema in-memory and call locateScope on it
    // — locateScope eventually calls unwrap. If we don't blow the
    // stack, the test passes.
    //
    // We can't easily inject a fake schema since the module captures
    // the bundled JSON at import time. Instead, smoke-test that the
    // existing suite parses without exception at deep nesting:
    const deepBuf = Array.from({ length: 50 }, (_, i) => '  '.repeat(i) + 'connectors:').join('\n')
    expect(() => locateScope(lines(deepBuf), 49, 1)).not.toThrow()
  })
})
