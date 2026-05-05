<template>
  <div class="app-shell">
    <header>
      <h1>WireViz GUI</h1>
      <span class="version">wireviz {{ health?.wireviz ?? '…' }}</span>
    </header>

    <main>
      <section class="editor">
        <label for="yaml-editor">YAML source</label>
        <textarea
          id="yaml-editor"
          v-model="yamlSource"
          spellcheck="false"
          @keydown.meta.enter.prevent="render"
          @keydown.ctrl.enter.prevent="render"
        />
        <div class="actions">
          <button :disabled="busy" @click="render">
            {{ busy ? 'Rendering…' : 'Render (⌘⏎)' }}
          </button>
          <label class="open-png">
            Open .png…
            <input type="file" accept="image/png" @change="openPng" />
          </label>
        </div>
        <p v-if="error" class="error">{{ error }}</p>
      </section>

      <section class="preview">
        <div v-if="result?.svg" class="svg-host" v-html="result.svg" />
        <p v-else-if="busy">Rendering…</p>
        <p v-else class="hint">Edit the YAML on the left, then ⌘⏎ to render.</p>
      </section>
    </main>
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

const busy = ref(false)
const error = ref<string | null>(null)
const result = ref<{ svg?: string; png_base64?: string; tsv?: string; bom?: any[] } | null>(null)

const { data: health } = await useFetch<{ wireviz: string }>('/api/wireviz/health', {
  // Don't block the page if the sidecar isn't running yet.
  default: () => null,
})

async function render() {
  busy.value = true
  error.value = null
  try {
    result.value = await $fetch('/api/wireviz/parse', {
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

// Render once on mount so first paint shows the example.
onMounted(() => {
  void render()
})
</script>

<style>
* { box-sizing: border-box; }
body, html, #__nuxt { height: 100%; margin: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }

.app-shell { display: flex; flex-direction: column; height: 100vh; }
header {
  padding: 0.6rem 1rem;
  border-bottom: 1px solid #ddd;
  display: flex;
  align-items: center;
  gap: 1rem;
}
header h1 { font-size: 1rem; margin: 0; }
.version { font-size: 0.75rem; color: #888; font-family: ui-monospace, monospace; }

main { flex: 1; display: grid; grid-template-columns: minmax(360px, 1fr) 2fr; min-height: 0; }
.editor, .preview { padding: 1rem; min-height: 0; display: flex; flex-direction: column; }
.editor { border-right: 1px solid #ddd; gap: 0.5rem; }
.editor textarea {
  flex: 1;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 0.85rem;
  line-height: 1.4;
  padding: 0.6rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  resize: none;
}
.actions { display: flex; gap: 0.5rem; align-items: center; }
.open-png { font-size: 0.85rem; cursor: pointer; }
.open-png input { display: none; }
.error { color: #b00020; font-family: ui-monospace, monospace; font-size: 0.8rem; white-space: pre-wrap; }
.preview { overflow: auto; }
.svg-host :deep(svg) { max-width: 100%; height: auto; }
.hint { color: #888; }
</style>
