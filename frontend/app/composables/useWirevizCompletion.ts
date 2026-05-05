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

function resolveRef(ref: string): JSONSchema {
  // We only support local refs of the form "#/definitions/<name>".
  const path = ref.replace(/^#\//, '').split('/')
  let node: any = schema
  for (const seg of path) node = node?.[seg]
  return node ?? {}
}

function unwrap(s: JSONSchema | undefined): JSONSchema {
  if (!s) return {}
  if (s.$ref) return unwrap(resolveRef(s.$ref))
  return s
}

/**
 * Determine which schema node best describes the YAML "scope" the cursor
 * sits in. We do this by walking the lines above the cursor and tracking
 * indent levels, mapping each indent step to the matching schema node.
 *
 * This is intentionally simple — it handles the common shapes
 * (top-level key, inside connectors.X1, inside cables.W1, value-of-key)
 * and falls back to the root schema if it can't decide.
 */
function locateScope(lines: string[], lineIndex: number): JSONSchema {
  // Walk upwards collecting the chain of "key:" headers above us, paying
  // attention to indent. Each indent decrease pops a level off the chain.
  type Frame = { indent: number; key: string }
  const chain: Frame[] = []
  for (let i = 0; i < lineIndex; i++) {
    const line = lines[i] ?? ''
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const indentMatch = line.match(/^(\s*)/)
    const indent = indentMatch ? indentMatch[1]!.length : 0
    const keyMatch = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/)
    if (!keyMatch) continue
    while (chain.length && chain[chain.length - 1]!.indent >= indent) chain.pop()
    chain.push({ indent, key: keyMatch[2]! })
  }

  // Resolve the chain through the schema. For object-of-X maps (connectors,
  // cables) the second-level key is a user-chosen designator and the schema
  // hangs off `additionalProperties`.
  let node: JSONSchema = schema
  for (const frame of chain) {
    node = unwrap(node)
    if (node.properties?.[frame.key]) {
      node = unwrap(node.properties[frame.key])
    } else if (node.additionalProperties && typeof node.additionalProperties === 'object') {
      // We're inside a map (e.g. connectors -> X1). The key is arbitrary;
      // the value's shape lives in additionalProperties.
      node = unwrap(node.additionalProperties)
    } else {
      // Lost track of the scope — bail and offer no completions for this branch.
      return {}
    }
  }
  return unwrap(node)
}

function buildKeyCompletions(
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
    const insertText = isArray
      ? `${key}:\n  - $0`
      : isObject
        ? `${key}:\n  $0`
        : sub.enum
          ? `${key}: \${1|${sub.enum.join(',')}|}$0`
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

function buildValueCompletions(
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
function valuePositionField(
  beforeCursor: string,
  scope: JSONSchema,
): JSONSchema | null {
  // Find the colon that splits "key: value" on this line. We use the
  // FIRST colon — anything after it is the value half, even if the
  // value itself happens to contain colons (e.g. inline timestamps).
  const colonIndex = beforeCursor.indexOf(':')
  if (colonIndex < 0) return null

  const keyText = beforeCursor.slice(0, colonIndex).trim()
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyText)) return null

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
      const scope = locateScope(lines, position.lineNumber - 1)

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
      const scope = locateScope(lines, position.lineNumber - 1)
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
