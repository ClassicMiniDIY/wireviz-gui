<template>
  <div class="app-shell">
    <header class="topnav">
      <div class="brand">
        <img src="/brand/logo-wheel.svg" alt="" class="wheel" />
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
        <a class="github-link" href="https://github.com/ClassicMiniDIY/wireviz-gui" target="_blank" rel="noopener" aria-label="GitHub">
          <i class="fa-brands fa-github" />
        </a>
      </div>
    </header>

    <main class="workspace">
      <section class="card editor-card">
        <div class="card-header">
          <span class="text-meta"><i class="fas fa-code" /> YAML source</span>
          <div class="card-actions">
            <label class="btn btn-ghost btn-sm" title="Import a previously rendered .png">
              <i class="fas fa-file-import" />
              <span>Open .png</span>
              <input type="file" accept="image/png" @change="openPng" hidden />
            </label>
            <button class="btn btn-primary btn-sm" :disabled="busy" @click="render">
              <i v-if="!busy" class="fas fa-play" />
              <i v-else class="fas fa-circle-notch fa-spin" />
              <span>{{ busy ? 'Rendering' : 'Render' }}</span>
              <kbd class="kbd">⌘⏎</kbd>
            </button>
          </div>
        </div>
        <textarea
          v-model="yamlSource"
          class="yaml-editor"
          spellcheck="false"
          @keydown.meta.enter.prevent="render"
          @keydown.ctrl.enter.prevent="render"
        />
        <div v-if="error" class="alert-error">{{ error }}</div>
      </section>

      <section class="card preview-card">
        <div class="card-header">
          <span class="text-meta"><i class="fas fa-diagram-project" /> Diagram</span>
          <div class="card-actions">
            <button
              class="btn btn-outline btn-sm"
              :disabled="!result?.svg"
              @click="downloadFile('svg')"
            >
              <i class="fas fa-download" /> SVG
            </button>
            <button
              class="btn btn-outline btn-sm"
              :disabled="!result?.png_base64"
              @click="downloadFile('png')"
            >
              <i class="fas fa-download" /> PNG
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
  png_base64?: string
  tsv?: string
  bom?: any[]
}

const busy = ref(false)
const error = ref<string | null>(null)
const result = ref<ParseResult | null>(null)

const { data: health } = await useFetch<{ wireviz: string }>('/api/wireviz/health', {
  default: () => null,
})

async function render() {
  busy.value = true
  error.value = null
  try {
    result.value = await $fetch<ParseResult>('/api/wireviz/parse', {
      method: 'POST',
      body: { yaml: yamlSource.value, formats: ['svg', 'png', 'tsv'] },
    })
  } catch (err: any) {
    error.value = err?.data?.detail ?? err?.statusMessage ?? String(err)
    result.value = null
  } finally {
    busy.value = false
  }
}

async function openPng(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  busy.value = true
  error.value = null
  try {
    const form = new FormData()
    form.append('file', file)
    const { yaml } = await $fetch<{ yaml: string }>('/api/wireviz/extract', {
      method: 'POST',
      body: form,
    })
    yamlSource.value = yaml
    await render()
  } catch (err: any) {
    error.value = err?.data?.detail ?? err?.statusMessage ?? String(err)
  } finally {
    busy.value = false
  }
}

function downloadFile(kind: 'svg' | 'png') {
  const r = result.value
  if (!r) return
  let blob: Blob
  if (kind === 'svg' && r.svg) {
    blob = new Blob([r.svg], { type: 'image/svg+xml' })
  } else if (kind === 'png' && r.png_base64) {
    const bin = atob(r.png_base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    blob = new Blob([bytes], { type: 'image/png' })
  } else {
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `harness.${kind}`
  a.click()
  URL.revokeObjectURL(url)
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

.github-link {
  color: var(--fg-2);
  font-size: var(--fs-lg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-field);
  transition: background var(--t-fast), color var(--t-fast);
}
.github-link:hover {
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

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-1);
  background: var(--bg-2);
}

.yaml-editor {
  flex: 1;
  width: 100%;
  border: 0;
  outline: 0;
  resize: none;
  padding: var(--space-4);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.55;
  color: var(--fg-1);
  background: var(--bg-1);
  min-height: 0;
}
.yaml-editor:focus { background: var(--bg-1); }

.alert-error {
  margin: 0 var(--space-4) var(--space-4);
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
