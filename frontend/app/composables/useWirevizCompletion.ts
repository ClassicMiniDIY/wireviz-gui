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

export function registerWirevizCompletion(monaco: typeof Monaco) {
  return monaco.languages.registerCompletionItemProvider('yaml', {
    triggerCharacters: [' ', ':', '\n'],
    provideCompletionItems(model, position) {
      const lines = model.getLinesContent()
      const currentLine = lines[position.lineNumber - 1] ?? ''
      const beforeCursor = currentLine.slice(0, position.column - 1)

      // Are we typing a value (after "key: ")? If so, find the field
      // schema and offer enum / boolean / examples for it.
      const valueMatch = beforeCursor.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^\s].*)?$/)
      if (valueMatch && (valueMatch[3] === undefined || valueMatch[3].trim() === '')) {
        const keyName = valueMatch[2]!
        const scope = locateScope(lines, position.lineNumber - 1)
        const fieldSchema = scope.properties?.[keyName]
        if (fieldSchema) {
          const word = model.getWordUntilPosition(position)
          const range: Monaco.IRange = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          }
          return { suggestions: buildValueCompletions(monaco, fieldSchema, range) }
        }
      }

      // Otherwise we're typing a key. Resolve the surrounding scope and
      // offer its known properties.
      const scope = locateScope(lines, position.lineNumber - 1)
      if (!scope.properties) return { suggestions: [] }
      const word = model.getWordUntilPosition(position)
      const range: Monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }
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
