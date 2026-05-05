<template>
  <div class="app-shell">
    <header class="topnav">
      <div class="brand">
        <img src="/brand/ios-icon.png" alt="" class="wheel" />
        <div class="brand-text">
          <span class="eyebrow">Part of Classic Mini DIY</span>
          <h1 class="brand-title">WireViz GUI</h1>
        </div>
      </div>
      <div class="nav-meta">
        <span v-if="health" class="version">
          <i class="fas fa-circle status-dot status-ok" /> wireviz {{ health.wireviz }}
        </span>
        <span v-else class="version">
          <i class="fas fa-circle status-dot status-down" /> sidecar offline
        </span>
        <button
          class="icon-btn"
          :title="theme === 'cmdiy-dark' ? 'Switch to light' : 'Switch to dark'"
          :aria-label="theme === 'cmdiy-dark' ? 'Switch to light theme' : 'Switch to dark theme'"
          @click="toggleTheme"
        >
          <i :class="theme === 'cmdiy-dark' ? 'fas fa-sun' : 'fas fa-moon'" />
        </button>
        <a class="icon-btn" href="https://github.com/ClassicMiniDIY/wireviz-gui" target="_blank" rel="noopener" aria-label="GitHub">
          <i class="fa-brands fa-github" />
        </a>
      </div>
    </header>

    <main class="workspace">
      <section
        class="card editor-card"
        :class="{ 'drop-target': dragActive }"
        @dragenter.prevent="onDragEnter"
        @dragover.prevent="onDragOver"
        @dragleave.prevent="onDragLeave"
        @drop.prevent="onDrop"
      >
        <div class="card-header">
          <span class="text-meta"><i class="fas fa-code" /> Editor</span>
          <div class="card-actions">
            <div class="dropdown" :class="{ open: templatesOpen }">
              <button
                class="btn btn-ghost btn-sm"
                aria-haspopup="menu"
                :aria-expanded="templatesOpen"
                @click="templatesOpen = !templatesOpen"
              >
                <i class="fas fa-file-lines" />
                <span>Templates</span>
                <i class="fas fa-chevron-down chev" />
              </button>
              <div v-if="templatesOpen" class="dropdown-menu" role="menu" @click.stop>
                <button
                  v-for="t in wirevizTemplates"
                  :key="t.id"
                  class="dropdown-item"
                  role="menuitem"
                  @click="loadTemplate(t.id)"
                >
                  <span class="item-title">{{ t.name }}</span>
                  <span class="item-desc">{{ t.description }}</span>
                </button>
              </div>
            </div>
            <label
              class="btn btn-ghost btn-sm"
              title="Open a .wvz project, .yml/.yaml, .png with embedded YAML, or drop image assets"
            >
              <i class="fas fa-folder-open" />
              <span>Open…</span>
              <input
                type="file"
                accept=".wvz,.yml,.yaml,.png,.jpg,.jpeg,.gif,.webp,.svg,application/zip,image/png"
                multiple
                @change="onPickFiles"
                hidden
              />
            </label>
            <button
              class="btn btn-ghost btn-sm"
              :title="assets.count.value === 0 ? 'Save project (.wvz) — currently no assets attached, but the YAML still bundles' : `Save project (.wvz) with ${assets.count.value} asset${assets.count.value === 1 ? '' : 's'}`"
              :disabled="savingProject"
              @click="saveProject"
            >
              <i v-if="!savingProject" class="fas fa-box-archive" />
              <i v-else class="fas fa-circle-notch fa-spin" />
              <span>Save .wvz</span>
            </button>
            <button class="btn btn-primary btn-sm" :disabled="busy" @click="render">
              <i v-if="!busy" class="fas fa-play" />
              <i v-else class="fas fa-circle-notch fa-spin" />
              <span>{{ busy ? 'Rendering' : 'Render' }}</span>
              <kbd class="kbd">⌘⏎</kbd>
            </button>
          </div>
        </div>

        <div v-if="assets.count.value > 0" class="asset-row">
          <span class="text-meta"><i class="fas fa-paperclip" /> Assets ({{ assets.count.value }})</span>
          <div class="asset-chips">
            <div v-for="a in assets.list.value" :key="a.name" class="asset-chip">
              <img v-if="a.type.startsWith('image/')" :src="a.objectUrl" :alt="a.name" class="asset-thumb" />
              <i v-else class="fas fa-file asset-thumb-fallback" />
              <span class="asset-name" :title="a.name">{{ a.name }}</span>
              <span class="asset-size">{{ formatBytes(a.size) }}</span>
              <button
                class="asset-remove"
                :title="`Remove ${a.name}`"
                :aria-label="`Remove ${a.name}`"
                @click="removeAsset(a.name)"
              >
                <i class="fas fa-xmark" />
              </button>
            </div>
          </div>
        </div>

        <ClientOnly>
          <MonacoEditor
            v-model="yamlSource"
            lang="yaml"
            class="yaml-editor"
            :options="monacoOptions"
            :theme="monacoTheme"
            @keydown="onEditorKeydown"
            @load="onEditorLoad"
          />
          <template #fallback>
            <pre class="yaml-editor-fallback">{{ yamlSource }}</pre>
          </template>
        </ClientOnly>

        <div v-if="error" class="alert-error">{{ error }}</div>

        <div v-if="dragActive" class="drop-overlay">
          <i class="fas fa-arrow-down-to-bracket drop-icon" />
          <p>
            Drop a <strong>.wvz</strong>, <strong>.yml</strong>, or
            <strong>.png</strong> to open it — or any image to attach as an asset.
          </p>
        </div>
      </section>

      <section class="card preview-card">
        <div class="card-header">
          <span class="text-meta"><i class="fas fa-diagram-project" /> Diagram</span>
          <div class="card-actions">
            <button
              class="btn btn-outline btn-sm"
              :disabled="!result?.svg || busy"
              @click="downloadSvg"
            >
              <i class="fas fa-download" /> SVG
            </button>
            <button
              class="btn btn-outline btn-sm"
              :disabled="!result?.svg || downloadingPng"
              :title="'Render PNG with embedded YAML for round-trip editing'"
              @click="downloadPng"
            >
              <i v-if="!downloadingPng" class="fas fa-download" />
              <i v-else class="fas fa-circle-notch fa-spin" />
              PNG
            </button>
          </div>
        </div>
        <div class="preview-body">
          <div v-if="result?.svg" class="svg-host" v-html="result.svg" />
          <div v-else-if="busy" class="empty-state">
            <i class="fas fa-circle-notch fa-spin big-icon" />
            <p>Rendering harness…</p>
          </div>
          <div v-else class="empty-state">
            <i class="fas fa-plug big-icon" />
            <p>Edit the YAML on the left, then <kbd class="kbd">⌘⏎</kbd> to render.</p>
          </div>
        </div>
      </section>
    </main>

    <footer class="site-footer">
      <p>
        <strong>WireViz GUI</strong> — wraps
        <a href="https://github.com/ClassicMiniDIY/WireViz" target="_blank" rel="noopener">WireViz 0.5.0</a>
        for interactive harness editing. A passion-project tool aligned with the
        <a href="https://classicminidiy.com" target="_blank" rel="noopener">Classic Mini DIY</a>
        YouTube channel and ecosystem.
      </p>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { wirevizTemplates, getTemplate } from '~/templates/wireviz'
import { buildAssetForm } from '~/composables/useAssets'
import {
  isProbablyImage,
  isProbablyYaml,
  packBundle,
  unpackBundle,
} from '~/composables/useWvzBundle'

const yamlSource = ref(`connectors:
  X1:
    type: D-Sub
    subtype: female
    pinlabels: [DCD, RX, TX, DTR, GND]
  X2:
    type: Molex KK 254
    subtype: female
    pinlabels: [GND, RX, TX]

cables:
  W1:
    gauge: 0.25 mm2
    length: 0.2
    color_code: DIN
    wirecount: 3
    shield: true

connections:
  -
    - X1: [5, 2, 3]
    - W1: [1, 2, 3]
    - X2: [1, 3, 2]
  -
    - X1: 5
    - W1: s
`)

type ParseResult = {
  svg?: string
  bom?: any[]
}

const busy = ref(false)
const downloadingPng = ref(false)
const savingProject = ref(false)
const error = ref<string | null>(null)
const result = ref<ParseResult | null>(null)

const { theme, toggle: toggleTheme } = useTheme()
const assets = useAssets()

const monacoTheme = computed(() => (theme.value === 'cmdiy-dark' ? 'vs-dark' : 'vs'))

const monacoOptions = {
  automaticLayout: true,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 13,
  lineNumbers: 'on' as const,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  tabSize: 2,
  insertSpaces: true,
  wordWrap: 'on' as const,
  renderLineHighlight: 'all' as const,
  padding: { top: 12, bottom: 12 },
  quickSuggestions: { other: 'on', comments: 'off', strings: 'on' } as const,
  suggestOnTriggerCharacters: true,
  acceptSuggestionOnEnter: 'smart' as const,
  tabCompletion: 'on' as const,
}

function onEditorKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    e.stopPropagation()
    void render()
  }
}

let completionDispose: (() => void) | null = null
let hoverDispose: (() => void) | null = null

async function onEditorLoad() {
  if (completionDispose || hoverDispose) return
  const { registerWirevizCompletion, registerWirevizHover } = await import(
    '~/composables/useWirevizCompletion'
  )
  const monaco = await useMonaco()
  completionDispose = registerWirevizCompletion(monaco).dispose
  hoverDispose = registerWirevizHover(monaco).dispose
}

const templatesOpen = ref(false)

function loadTemplate(id: string) {
  const t = getTemplate(id)
  if (!t) return
  yamlSource.value = t.yaml
  templatesOpen.value = false
  void render()
}

function handleDocClick(e: MouseEvent) {
  const root = (e.target as Element)?.closest('.dropdown')
  if (!root) templatesOpen.value = false
}
function handleDocKey(e: KeyboardEvent) {
  if (e.key === 'Escape') templatesOpen.value = false
}
onMounted(() => {
  document.addEventListener('click', handleDocClick)
  document.addEventListener('keydown', handleDocKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocClick)
  document.removeEventListener('keydown', handleDocKey)
  completionDispose?.()
  hoverDispose?.()
})

const { data: health } = await useFetch<{ wireviz: string }>('/api/wireviz/health', {
  default: () => null,
})

// ---- Render: multipart when assets present, JSON otherwise -------------

async function render() {
  busy.value = true
  error.value = null
  try {
    if (assets.count.value > 0) {
      // Multipart path: send YAML + every attached asset so the engine
      // can resolve `image: src: foo.png` references.
      const form = buildAssetForm(
        { yaml: yamlSource.value, formats: ['svg'], embed_yaml: 'true' },
        assets.list.value,
      )
      result.value = await $fetch<ParseResult>('/api/wireviz/parse-multipart', {
        method: 'POST',
        body: form,
      })
    } else {
      result.value = await $fetch<ParseResult>('/api/wireviz/parse', {
        method: 'POST',
        body: { yaml: yamlSource.value, formats: ['svg'] },
      })
    }
  } catch (err: any) {
    error.value = err?.data?.detail ?? err?.statusMessage ?? String(err)
    result.value = null
  } finally {
    busy.value = false
  }
}

// ---- File pickers / drag-drop ------------------------------------------

async function onPickFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  await ingestFiles(files)
}

async function onDrop(e: DragEvent) {
  dragActive.value = false
  const files = Array.from(e.dataTransfer?.files ?? [])
  await ingestFiles(files)
}

const dragActive = ref(false)
let dragDepth = 0

function onDragEnter(_e: DragEvent) {
  dragDepth += 1
  dragActive.value = true
}
function onDragOver(e: DragEvent) {
  // Tell the browser we accept the drop so the cursor changes.
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}
function onDragLeave(_e: DragEvent) {
  dragDepth -= 1
  if (dragDepth <= 0) {
    dragDepth = 0
    dragActive.value = false
  }
}

/**
 * Smart router for incoming files. Each file is dispatched by extension:
 *   .wvz  -> unpack into editor + asset map (replaces both)
 *   .yml/.yaml -> load as the editor buffer
 *   .png with iTXt -> extract YAML and load
 *   image/* (other) -> attach as an asset
 *
 * Errors per-file are surfaced into the alert pane but don't abort the
 * batch — the user dropping a folder of mixed files still gets the
 * useful ones picked up.
 */
async function ingestFiles(files: File[]) {
  if (!files.length) return
  busy.value = true
  error.value = null
  const errors: string[] = []
  try {
    for (const f of files) {
      try {
        if (/\.wvz$/i.test(f.name) || f.type === 'application/zip') {
          const { yaml, assets: bundleAssets } = await unpackBundle(f)
          yamlSource.value = yaml
          assets.replaceAll(bundleAssets)
        } else if (isProbablyYaml(f.name)) {
          yamlSource.value = await f.text()
        } else if (/\.png$/i.test(f.name)) {
          // Try iTXt extraction first; if that fails (no embedded YAML)
          // fall through to "attach as asset" so users can drop reference
          // images that happen to be PNG.
          try {
            const form = new FormData()
            form.append('file', f)
            const { yaml } = await $fetch<{ yaml: string }>('/api/wireviz/extract', {
              method: 'POST',
              body: form,
            })
            yamlSource.value = yaml
          } catch {
            assets.add(f)
          }
        } else if (isProbablyImage(f.name) || f.type.startsWith('image/')) {
          assets.add(f)
        } else {
          errors.push(`${f.name}: unsupported file type`)
        }
      } catch (err: any) {
        errors.push(`${f.name}: ${err?.data?.detail ?? err?.message ?? String(err)}`)
      }
    }
    if (errors.length) error.value = errors.join('\n')
    await render()
  } finally {
    busy.value = false
  }
}

function removeAsset(name: string) {
  assets.remove(name)
  void render()
}

// ---- Save .wvz ---------------------------------------------------------

async function saveProject() {
  savingProject.value = true
  error.value = null
  try {
    const blob = await packBundle(yamlSource.value, assets.list.value)
    triggerDownload(blob, 'harness.wvz')
  } catch (err: any) {
    error.value = err?.message ?? String(err)
  } finally {
    savingProject.value = false
  }
}

// ---- Diagram downloads -------------------------------------------------

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function downloadSvg() {
  if (!result.value?.svg) return
  triggerDownload(new Blob([result.value.svg], { type: 'image/svg+xml' }), 'harness.svg')
}

async function downloadPng() {
  if (!result.value?.svg) return
  downloadingPng.value = true
  error.value = null
  try {
    let buf: ArrayBuffer
    if (assets.count.value > 0) {
      const form = buildAssetForm(
        { yaml: yamlSource.value, embed_yaml: 'true' },
        assets.list.value,
      )
      buf = await $fetch<ArrayBuffer>('/api/wireviz/render/png-multipart', {
        method: 'POST',
        body: form,
        responseType: 'arrayBuffer',
      })
    } else {
      buf = await $fetch<ArrayBuffer>('/api/wireviz/render/png', {
        method: 'POST',
        body: { yaml: yamlSource.value, embed_yaml: true },
        responseType: 'arrayBuffer',
      })
    }
    triggerDownload(new Blob([buf], { type: 'image/png' }), 'harness.png')
  } catch (err: any) {
    error.value = err?.data?.detail ?? err?.statusMessage ?? String(err)
  } finally {
    downloadingPng.value = false
  }
}

// ---- Helpers -----------------------------------------------------------

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

onMounted(() => {
  void render()
})
</script>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg-2);
}

/* ===== Top nav ===== */
.topnav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-6);
  background: var(--bg-1);
  border-bottom: 1px solid var(--border-1);
}
.brand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.wheel {
  width: 38px;
  height: 38px;
  display: block;
  border-radius: 8px;
}
.brand-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.brand-title {
  font-size: var(--fs-lg);
  font-weight: var(--fw-bold);
  letter-spacing: var(--tracking-tight);
  line-height: 1;
}
.eyebrow { line-height: 1; }

.nav-meta {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.version {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--fg-2);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.status-dot { font-size: 8px; }
.status-ok { color: var(--cm-success); }
.status-down { color: var(--cm-error); }

.icon-btn {
  color: var(--fg-2);
  font-size: var(--fs-lg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-field);
  border: 0;
  background: transparent;
  cursor: pointer;
  transition: background var(--t-fast), color var(--t-fast);
}
.icon-btn:hover {
  background: var(--bg-2);
  color: var(--fg-1);
  text-decoration: none;
}

/* ===== Workspace ===== */
.workspace {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(380px, 1fr) 1.6fr;
  gap: var(--space-4);
  padding: var(--space-4);
  min-height: 0;
}
.editor-card,
.preview-card {
  min-height: 0;
}
.editor-card {
  position: relative; /* drop overlay anchor */
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-1);
  background: var(--bg-2);
  flex-wrap: wrap;
  gap: var(--space-2);
}

.yaml-editor {
  flex: 1;
  width: 100%;
  min-height: 0;
}
.yaml-editor-fallback {
  flex: 1;
  width: 100%;
  margin: 0;
  padding: var(--space-4);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.55;
  color: var(--fg-1);
  background: var(--bg-1);
  overflow: auto;
  min-height: 0;
}

.alert-error {
  margin: 0 var(--space-4) var(--space-4);
}

/* ===== Asset chips ===== */
.asset-row {
  padding: var(--space-2) var(--space-4);
  border-bottom: 1px solid var(--border-1);
  background: var(--bg-1);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.asset-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.asset-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 4px 8px 4px 4px;
  background: var(--bg-2);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
  max-width: 240px;
}
.asset-thumb {
  width: 24px;
  height: 24px;
  object-fit: cover;
  border-radius: 4px;
  background: var(--bg-3);
  flex-shrink: 0;
}
.asset-thumb-fallback {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-3);
}
.asset-name {
  font-family: var(--font-mono);
  color: var(--fg-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.asset-size { color: var(--fg-3); }
.asset-remove {
  border: 0;
  background: transparent;
  color: var(--fg-3);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.asset-remove:hover { background: var(--bg-3); color: var(--fg-1); }

/* ===== Drop overlay ===== */
.editor-card.drop-target { outline: 2px dashed var(--cm-primary); outline-offset: -2px; }
.drop-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  background: color-mix(in srgb, var(--cm-primary) 12%, var(--bg-1));
  pointer-events: none;
  z-index: 10;
  text-align: center;
  padding: var(--space-6);
}
.drop-overlay p {
  max-width: 380px;
  color: var(--fg-1);
  font-size: var(--fs-sm);
}
.drop-icon {
  font-size: 36px;
  color: var(--cm-primary);
}

/* ===== Preview ===== */
.preview-body {
  flex: 1;
  overflow: auto;
  padding: var(--space-6);
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  background:
    repeating-linear-gradient(
      45deg,
      var(--bg-2),
      var(--bg-2) 10px,
      var(--bg-1) 10px,
      var(--bg-1) 20px
    );
}
.svg-host { width: 100%; }
.svg-host :deep(svg) {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 0 auto;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  color: var(--fg-3);
  text-align: center;
}
.big-icon {
  font-size: 36px;
  color: var(--cm-primary);
  opacity: 0.5;
}

.kbd {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 1px 6px;
  border: 1px solid var(--border-2);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--bg-1);
  color: var(--fg-2);
  margin-left: 4px;
}

/* ===== Dropdown ===== */
.dropdown { position: relative; }
.dropdown .chev {
  font-size: 9px;
  margin-left: 2px;
  transition: transform var(--t-fast);
}
.dropdown.open .chev { transform: rotate(180deg); }

.dropdown-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 280px;
  max-width: 360px;
  max-height: 70vh;
  overflow-y: auto;
  background: var(--bg-1);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-box);
  box-shadow: var(--shadow-lg);
  padding: var(--space-1);
  z-index: 50;
  display: flex;
  flex-direction: column;
}
.dropdown-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: var(--space-2) var(--space-3);
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: var(--radius-field);
  cursor: pointer;
  font: inherit;
  color: var(--fg-1);
  transition: background var(--t-fast);
}
.dropdown-item:hover { background: var(--bg-2); }
.item-title {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
}
.item-desc {
  font-size: var(--fs-xs);
  color: var(--fg-3);
  line-height: 1.35;
}

/* ===== Footer ===== */
.site-footer {
  padding: var(--space-3) var(--space-6);
  border-top: 1px solid var(--border-1);
  background: var(--bg-1);
  text-align: center;
}
.site-footer p {
  font-size: var(--fs-sm);
  color: var(--fg-2);
  max-width: 720px;
  margin: 0 auto;
}
</style>
