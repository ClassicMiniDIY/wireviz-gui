// Schema-driven YAML autocomplete for the WireViz editor.
//
// Why a hand-rolled provider instead of monaco-yaml:
// - monaco-yaml needs a dedicated web worker, and nuxt-monaco-editor's
//   getWorker shim doesn't compose cleanly with it (you end up with two
//   parallel Monaco runtimes and "depends on UNKNOWN service" errors).
// - The schema is small enough that a CompletionItemProvider walking
//   the JSON schema in-process is plenty: ~150 lines, no workers,
//   instant suggestions, and the hover tooltips read straight from
//   the schema's `description` fields.
//
// We register one CompletionItemProvider for the `yaml` language. It's
// context-aware via simple line/indent inspection — Monaco doesn't
// give us a parsed AST without a worker, so we pattern-match on the
// editor text to figure out where the cursor is in the YAML tree.

import type * as Monaco from 'monaco-editor'

import wirevizSchema from '~/schemas/wireviz.schema.json'

type JSONSchema = {
  type?: string | string[]
  description?: string
  enum?: string[]
  examples?: unknown[]
  properties?: Record<string, JSONSchema>
  additionalProperties?: boolean | JSONSchema
  items?: JSONSchema | boolean
  $ref?: string
  oneOf?: JSONSchema[]
  required?: string[]
  definitions?: Record<string, JSONSchema>
}

const schema = wirevizSchema as unknown as JSONSchema

// Patterns for matching YAML keys. We accept identifier-like names with
// dashes (e.g. `pin-labels`) and the YAML merge key `<<` (used by
// templates that reuse anchors via `<<: *anchor`). Keys that don't fit
// these — quoted strings, complex keys, etc. — get skipped during scope
// resolution; that's a reasonable degradation since they're rare in
// WireViz YAML and skipping them just leaves more ancestor frames in
// the chain than necessary, not less.
//
// YAML_KEY_RE matches `key:` at the start of a string; YAML_KEY_LINE_RE
// is the same pattern anchored to a full line for top-level scanning.
const YAML_KEY_RE = /^([A-Za-z_][A-Za-z0-9_-]*|<<)\s*:/
const YAML_KEY_LINE_RE = /^(\s*)([A-Za-z_][A-Za-z0-9_-]*|<<)\s*:\s*(.*)$/

function resolveRef(ref: string): JSONSchema {
  // We only support local refs of the form "#/definitions/<name>".
  const path = ref.replace(/^#\//, '').split('/')
  let node: any = schema
  for (const seg of path) node = node?.[seg]
  return node ?? {}
}

// Hard ceiling on $ref resolution depth so a malformed schema with a
// circular reference can't stack-overflow the editor. Our real schema
// only chains one level deep (e.g. cable.colors → array of colorCode),
// so 16 leaves enormous headroom; if we ever blow past it we'd rather
// see an empty completion list than a frozen tab.
const MAX_REF_DEPTH = 16

function unwrap(s: JSONSchema | undefined, depth = 0): JSONSchema {
  if (!s) return {}
  if (s.$ref) {
    if (depth >= MAX_REF_DEPTH) return {}
    return unwrap(resolveRef(s.$ref), depth + 1)
  }
  return s
}

/**
 * Determine which schema node best describes the YAML "scope" the cursor
 * sits in. We do this by walking the lines above the cursor and tracking
 * indent levels, mapping each indent step to the matching schema node.
 *
 * Two frame types model the YAML structure:
 *   - 'key'  — a `key:` mapping at a given indent
 *   - 'item' — a `- ` list-item marker at a given indent
 *
 * A line like `  - type: Foo` produces BOTH frames at once: an item
 * frame at the indent of the dash, then a key frame for `type` at
 * the indent of the dash + 2. That's how YAML treats it logically
 * (the `- ` and a separate `type: Foo` line at one extra indent are
 * structurally identical), and it lets us walk into items["type"]
 * for schemas like additional_components → AdditionalComponent.
 *
 * Resolution descends `properties` for keys, `additionalProperties`
 * for designator maps (connectors → X1), and `items` for arrays.
 */
export function locateScope(
  lines: string[],
  lineIndex: number,
  cursorColumn: number = 1,
): JSONSchema {
  type KeyFrame = { kind: 'key'; indent: number; key: string }
  type ItemFrame = { kind: 'item'; indent: number }
  type Frame = KeyFrame | ItemFrame

  const chain: Frame[] = []
  // Walk every line up to AND INCLUDING the cursor line. The cursor line
  // matters: when the user is typing right after a `- ` marker, that
  // marker is on the cursor line itself and would otherwise be missed.
  // For the cursor line we only consider text before the cursor.

  // Effective indent of the cursor's intended position. For a typical
  // key line this is the leading whitespace; for a `- ` line where the
  // cursor sits past the dash it's "leading whitespace + 2" (the column
  // past the `- ` is the item-content indent).
  const cursorLineRaw = lines[lineIndex] ?? ''
  const cursorLineTrunc = cursorLineRaw.slice(0, cursorColumn - 1)
  const dashOnCursorLine = cursorLineTrunc.match(/^(\s*)-(?:\s|$)/)
  const cursorEffectiveIndent = dashOnCursorLine
    ? dashOnCursorLine[1]!.length + 2
    : (cursorLineTrunc.match(/^(\s*)/)?.[1]?.length ?? 0)

  for (let i = 0; i <= lineIndex; i++) {
    const raw = lines[i] ?? ''
    const line = i < lineIndex ? raw : raw.slice(0, cursorColumn - 1)
    if (!line.trim() || line.trimStart().startsWith('#')) continue

    const indentMatch = line.match(/^(\s*)/)
    const indent = indentMatch ? indentMatch[1]!.length : 0

    // Pop frames at the same or deeper indent — siblings/children of a
    // prior tree position can't be ancestors of the cursor.
    const popTo = (cutoff: number) => {
      while (chain.length && chain[chain.length - 1]!.indent >= cutoff) {
        chain.pop()
      }
    }

    // List-item marker: `- ` at the start of the line, optionally with
    // an inline `key: value` after it. The dash sits at `indent`; any
    // inline key sits at `indent + 2` (the column past `- `).
    const itemMatch = line.match(/^(\s*)-(?:\s+(.*))?$/)
    if (itemMatch) {
      popTo(indent)
      chain.push({ kind: 'item', indent })
      const rest = itemMatch[2] ?? ''
      const inlineKey = rest.match(YAML_KEY_RE)
      if (inlineKey) {
        chain.push({ kind: 'key', indent: indent + 2, key: inlineKey[1]! })
      }
      continue
    }

    // Plain `key:` line.
    const keyMatch = line.match(YAML_KEY_LINE_RE)
    if (!keyMatch) continue
    popTo(indent)
    chain.push({ kind: 'key', indent, key: keyMatch[2]! })
  }

  // Strip trailing frames at indent >= cursor — those are siblings (or
  // children) of the cursor's intended position, not ancestors.
  while (
    chain.length &&
    chain[chain.length - 1]!.indent >= cursorEffectiveIndent
  ) {
    chain.pop()
  }

  // Resolve the chain through the schema.
  let node: JSONSchema = schema
  for (const frame of chain) {
    node = unwrap(node)
    if (frame.kind === 'item') {
      if (node.items && typeof node.items === 'object') {
        node = unwrap(node.items)
      } else {
        return {}
      }
      continue
    }
    if (node.properties?.[frame.key]) {
      node = unwrap(node.properties[frame.key])
    } else if (node.additionalProperties && typeof node.additionalProperties === 'object') {
      // We're inside a map (e.g. connectors -> X1). The key is arbitrary;
      // the value's shape lives in additionalProperties.
      node = unwrap(node.additionalProperties)
    } else {
      return {}
    }
  }
  return unwrap(node)
}

export function buildKeyCompletions(
  monaco: typeof Monaco,
  scope: JSONSchema,
  range: Monaco.IRange,
): Monaco.languages.CompletionItem[] {
  const props = scope.properties ?? {}
  return Object.entries(props).map(([key, raw]) => {
    const sub = unwrap(raw)
    const isObject = sub.type === 'object' || !!sub.properties
    const isArray = sub.type === 'array'
    // For scalar fields we want `key: ` ready for typing; for objects/arrays
    // we drop a structured snippet so the cursor lands on a usable shape.
    //
    // Monaco choice-snippet syntax `${1|a,b|}` uses `,` as the value
    // separator AND `|` as the delimiter — both are unescapable in the
    // current snippet grammar. If any enum value contains either, the
    // snippet would parse ambiguously, so we fall back to a plain
    // `key: ` and let the regular completion provider surface the
    // value list once the user starts typing the value.
    const enumSafeForSnippet =
      sub.enum && sub.enum.every((v) => !v.includes(',') && !v.includes('|'))
    const insertText = isArray
      ? `${key}:\n  - $0`
      : isObject
        ? `${key}:\n  $0`
        : enumSafeForSnippet
          ? `${key}: \${1|${sub.enum!.join(',')}|}$0`
          : `${key}: $0`
    return {
      label: key,
      kind: isObject || isArray
        ? monaco.languages.CompletionItemKind.Module
        : monaco.languages.CompletionItemKind.Property,
      insertText,
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: sub.description
        ? { value: sub.description, isTrusted: false }
        : undefined,
      range,
    }
  })
}

export function buildValueCompletions(
  monaco: typeof Monaco,
  fieldSchema: JSONSchema,
  range: Monaco.IRange,
): Monaco.languages.CompletionItem[] {
  const sub = unwrap(fieldSchema)
  const candidates: string[] = []
  if (sub.enum) candidates.push(...sub.enum)
  if (sub.examples) candidates.push(...(sub.examples as string[]))
  // Walk oneOf branches for things like shield: bool | colorCode
  if (sub.oneOf) {
    for (const branch of sub.oneOf) {
      const ub = unwrap(branch)
      if (ub.enum) candidates.push(...ub.enum)
      if (ub.examples) candidates.push(...(ub.examples as string[]))
      if (ub.type === 'boolean') candidates.push('true', 'false')
    }
  }
  if (sub.type === 'boolean') candidates.push('true', 'false')

  return [...new Set(candidates)].map((value) => ({
    label: value,
    kind: monaco.languages.CompletionItemKind.Value,
    insertText: value,
    documentation: sub.description
      ? { value: sub.description, isTrusted: false }
      : undefined,
    range,
  }))
}

/**
 * Decide whether the cursor sits in the value half of a "key: value" line,
 * and if so return the matching field schema. Handles three shapes:
 *
 *   color_code: D|             -> value of color_code, prefix "D"
 *   colors: [WH, B|]           -> value of colors[items], prefix "B"
 *   color: |                   -> value of color, no prefix
 *
 * When the cursor is inside a `[...]` array literal we descend into the
 * field's `items` schema so the completions come from the element type
 * (e.g. colorCode) rather than the array container itself.
 */
export function valuePositionField(
  beforeCursor: string,
  scope: JSONSchema,
): JSONSchema | null {
  // Find the colon that splits "key: value" on this line. We use the
  // FIRST colon — anything after it is the value half, even if the
  // value itself happens to contain colons (e.g. inline timestamps).
  const colonIndex = beforeCursor.indexOf(':')
  if (colonIndex < 0) return null

  const keyText = beforeCursor.slice(0, colonIndex).trim()
  if (!/^([A-Za-z_][A-Za-z0-9_-]*|<<)$/.test(keyText)) return null

  const fieldSchema = scope.properties?.[keyText]
  if (!fieldSchema) return null
  const sub = unwrap(fieldSchema)

  // Inside a `[...]` array literal? Use the items schema so we offer
  // element-level enum / examples instead of the array container itself.
  const afterColon = beforeCursor.slice(colonIndex + 1)
  const inArray =
    afterColon.lastIndexOf('[') > afterColon.lastIndexOf(']')
  if (inArray && sub.items && typeof sub.items === 'object') {
    return unwrap(sub.items)
  }
  return sub
}

export function registerWirevizCompletion(monaco: typeof Monaco) {
  return monaco.languages.registerCompletionItemProvider('yaml', {
    // Letters / digits are also handled — Monaco re-queries the provider
    // as the user types, and the trigger chars cover the cases where we
    // want to fire mid-line on an empty word (after `: `, after `[`).
    triggerCharacters: [' ', ':', '[', ',', '\n'],
    provideCompletionItems(model, position) {
      const lines = model.getLinesContent()
      const currentLine = lines[position.lineNumber - 1] ?? ''
      const beforeCursor = currentLine.slice(0, position.column - 1)
      const word = model.getWordUntilPosition(position)
      const range: Monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }

      // Resolve the YAML scope once; both branches need it.
      const scope = locateScope(lines, position.lineNumber - 1, position.column)

      // Value branch: are we past a colon on this line?
      const valueSchema = valuePositionField(beforeCursor, scope)
      if (valueSchema) {
        return { suggestions: buildValueCompletions(monaco, valueSchema, range) }
      }

      // Key branch: cursor is at the start of a line / in a key word —
      // offer the surrounding scope's known properties.
      if (!scope.properties) return { suggestions: [] }
      return { suggestions: buildKeyCompletions(monaco, scope, range) }
    },
  })
}

/**
 * Schema-driven hover descriptions. Same scope-locator as the completion
 * provider so the tooltip matches what autocomplete just suggested.
 */
export function registerWirevizHover(monaco: typeof Monaco) {
  return monaco.languages.registerHoverProvider('yaml', {
    provideHover(model, position) {
      const word = model.getWordAtPosition(position)
      if (!word) return null
      const lines = model.getLinesContent()
      const scope = locateScope(lines, position.lineNumber - 1, position.column)
      const sub = unwrap(scope.properties?.[word.word])
      if (!sub.description) return null
      return {
        range: new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn,
        ),
        contents: [
          { value: `**${word.word}**` },
          { value: sub.description },
        ],
      }
    },
  })
}
