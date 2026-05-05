# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A two-process desktop-style web app that turns [WireViz](https://github.com/ClassicMiniDIY/WireViz) YAML into rendered harness diagrams interactively:

- **`frontend/`** — Nuxt 4 (compatibilityDate `2025-07-15`). Single-page editor + diagram preview. Nitro server routes under `server/api/wireviz/*` proxy to the sidecar so the sidecar URL is server-only and CORS doesn't fire in production.
- **`sidecar/`** — Python FastAPI service (`wireviz_gui_sidecar`) that imports WireViz 0.5.0 as a library. Listens on `127.0.0.1:8765` by default. This is the **only** place WireViz is loaded.

The engine repo lives next to this one at `../WireViz` (absolute: `/Users/colegentry/Development/WireViz`) and is installed editably — its `CLAUDE.md` documents the engine internals and is required reading before changing anything that crosses the API boundary.

## Commands

```bash
# First-time setup
pnpm setup:sidecar       # uv venv at sidecar/.venv (Python 3.12) + editable wireviz install
pnpm setup:frontend      # pnpm install for Nuxt

# Day-to-day
pnpm dev                 # both processes via concurrently: sidecar :8765, Nuxt :3000
pnpm dev:sidecar         # uvicorn --reload only
pnpm dev:frontend        # nuxt dev only

# Tests (sidecar + frontend, 67 total)
pnpm test                # both runners
pnpm test:sidecar        # 16 pytest tests (FastAPI TestClient against the real engine)
pnpm test:frontend       # 51 vitest specs (composables + templates + completion)
sidecar/.venv/bin/pytest sidecar/tests/test_smoke.py::test_png_round_trip_via_extract  # one test
cd frontend && pnpm test:watch  # vitest in watch mode

# Production build
pnpm build               # nuxt build (also typechecks the server routes)
```

`graphviz` (the `dot` binary) must be on `PATH` — the sidecar shells out via the `graphviz` Python package. WireViz is pinned to a local path in `sidecar/pyproject.toml` (`wireviz @ file:///Users/colegentry/Development/WireViz`); change that line and re-run `pnpm setup:sidecar` to point at a different checkout.

## Architecture

The data flow is one-way for rendering, two-way for round-trip:

```
browser  ──fetch──>  Nuxt server route ──$fetch──>  FastAPI sidecar ──>  wireviz.wireviz.parse()
   ^                  /api/wireviz/*                  /parse, /extract        │
   │                                                                          v
   └────────  SVG string + base64 PNG + TSV + BOM rows  ─── Harness._render ──┘
```

When the YAML references images via `image: src: foo.png`, the request goes through the
multipart variants instead — same flow with the file uploads attached:

```
browser  ──FormData──>  /api/wireviz/parse-multipart   ──>  /parse-multipart
                          (yaml + N file parts)              │
                                                             ├─ tempfile.TemporaryDirectory()
                                                             ├─ write each upload to <td>/<basename>
                                                             ├─ wireviz.parse(yaml, image_paths=[<td>])
                                                             └─ tempdir auto-deleted on response
```

### Frontend tests (`frontend/tests/`)

Vitest with two environments:
- **`tests/unit/*`** runs in `happy-dom` — pure module tests that need browser-shaped DOM globals (Blob, File, URL.createObjectURL, FormData) but no Nuxt context. Covers `useZipBundle` (pack / unpack / round-trip / predicates), `useWirevizCompletion` (locateScope across every YAML shape, valuePositionField with prefixes and array literals, key/value completion builders), and `templates` (every template parses as YAML, ids unique, asset URLs match files we ship, every YAML `image: src:` is in the template's bundled assets).
- **`tests/nuxt/*`** runs in the Nuxt test environment (provides `useState`). Covers `useAssets` (add / replace / remove / clear / replaceAll / sorting / total bytes) and `buildAssetForm`. The Nuxt env's `URL.createObjectURL` is stubbed in `beforeAll` because node:buffer's strict validator doesn't accept happy-dom-shaped Blobs across realms.

`vitest.config.ts` uses `pool: 'forks'` — without it the Nuxt test env leaks a Vite server after the suite finishes and breaks the exit code.

App.vue itself isn't unit-tested; it's mostly orchestration around the composables (which are tested) and is verified end-to-end via manual smoke + the in-browser scripted tests we ran during development.

### Frontend (`frontend/`)

- **`app/app.vue`** — the entire UI: Monaco editor on the left, SVG preview on the right, asset chip row above the editor, drag-drop overlay over the editor card. `⌘⏎` to render. Routes incoming files by extension via `ingestFiles`: `.zip` unpacks into editor + asset map, `.yml/.yaml` loads as the editor buffer, `.png` tries iTXt extraction first then falls back to "attach as asset" if no embedded YAML, any other image attaches directly. The render call branches on `assets.count`: empty → JSON `/parse`, populated → multipart `/parse-multipart`. Same branch on PNG download.
- **`app/composables/useAssets.ts`** — reactive `Map<filename, AssetEntry>` keyed by basename. Last-write-wins on duplicate names. Exposes `add` / `remove` / `clear` / `replaceAll` plus a `buildAssetForm(fields, assets)` helper that constructs the `FormData` the sidecar's multipart endpoints expect (yaml + non-file fields + repeated `files` parts).
- **`app/composables/useZipBundle.ts`** — `.zip` pack / unpack via JSZip. Bundle layout is a flat zip: `harness.yml` at the root, image files alongside it. Flat layout means `image: src: foo.png` resolves against the bundle root without rewriting paths on save. Tolerant unpacker: prefers `harness.yml`, falls back to first `.yml/.yaml`, flattens any nested image paths to basenames.
- **`nuxt.config.ts`** — `runtimeConfig.sidecarUrl` (server-only, no `public.*` mirror — keeping the URL out of the browser bundle is intentional).
- **`server/api/wireviz/`** — thin proxies. `parse.post.ts` forwards JSON; `parse-multipart.post.ts` and `render/png-multipart.post.ts` rebuild the multipart body as a real `FormData` before forwarding (Nitro parses the inbound parts but we have to reconstruct the boundary on the outbound). `extract.post.ts` rebuilds for PNG → YAML extraction. `health.get.ts` is a passthrough that converts sidecar timeout into `503`. All proxies convert sidecar errors into `createError({ data: { detail } })` so `err.data.detail` reaches the UI verbatim.

### Sidecar (`sidecar/wireviz_gui_sidecar/`)

- **`app.py`** — FastAPI surface. The endpoints all funnel through `_do_parse` / `_do_render_one`: `wireviz.parse(return_types="harness", image_paths=[...])` to get the in-memory `Harness`, then `harness._render((fmt, ...), yaml_source=...)` to produce bytes/strings. `bom_rows = harness.bom()` is included separately so the UI doesn't have to parse TSV. The multipart endpoints (`parse-multipart`, `render/svg-multipart`, `render/png-multipart`) spool uploaded files into a per-request `tempfile.TemporaryDirectory` and pass that to WireViz as `image_paths` — no asset state persists between requests.
- **`__main__.py`** — uvicorn entrypoint, exposed as the `wireviz-gui-sidecar` console script. Reads `WIREVIZ_GUI_HOST` / `WIREVIZ_GUI_PORT` env vars.
- **`tests/test_smoke.py`** — uses FastAPI's `TestClient` against the real WireViz engine (no mocks) so engine-API drift is caught here first. 16 tests covering: health, JSON parse / render, PNG iTXt round-trip, multipart parse + render with image uploads, multiple-file uploads, path-traversal sanitization (uploads with `../` in filename get basename-stripped), missing-asset 422, BOM row shape, all output formats (svg/png/tsv/html/gv).

## Project bundle format

The "Save .zip" button writes a plain `.zip` archive — no custom extension, no magic header. Layout is flat:

```
harness.yml      ← required; the YAML at the root
foo.png          ← any image referenced by `image: src: foo.png`
bar.jpg          ← etc — basename match against image_paths
```

**Flat layout is intentional**: `image: src: foo.png` in the YAML resolves against the directory the sidecar spools the assets into (a per-request tempdir built from the zip's contents), so no path rewriting on save. The pack/unpack functions in [`useZipBundle`](frontend/app/composables/useZipBundle.ts) enforce this by flattening any nested entry to its basename on import.

The PNG iTXt round-trip mechanism is a separate channel: rendered PNGs only carry the YAML, not the assets. To round-trip a project that references images, save as `.zip`. To share a single rendered diagram that stands on its own, the existing PNG iTXt path is fine.

## Load-bearing engine contracts

These three behaviors come from the engine repo and **must** stay correct for the GUI to work. If the sidecar tests start failing after an engine bump, this is where to look.

1. **`wireviz.parse()` is the only public entry — never shell out to the `wireviz` CLI.** The CLI (`wv_cli.py`) is a thin Click wrapper; the GUI must drive the library directly so errors are structured exceptions, not stderr scraping.

2. **PNG embedding only happens via `Harness._render`.** The engine has two PNG paths:
   - `harness.png` (the property used by `parse(return_types="png")`) does **NOT** embed YAML.
   - `harness._render(("png",), yaml_source=...)` embeds the YAML in a `wireviz:yaml` iTXt chunk.

   The sidecar always uses `_render` so PNGs round-trip. `_render` returns `{fmt: bytes|str}` — binary formats (`png`) are bytes, text formats (`svg`, `html`, `gv`, `tsv`) are str. Don't break that contract.

3. **PNG → YAML round-trip via `read_yaml_from_png`.** Imported from `wireviz.Harness`. The "Open…" button relies on this. If a user uploads a PNG that wasn't rendered with `embed_yaml=True`, the sidecar returns 404 — the frontend catches that and falls through to "attach as asset" so users can drop reference images that happen to be PNG.

4. **Asset path resolution via `image_paths=[tmpdir]`.** WireViz resolves relative `image: src: foo.png` paths against `image_paths`. Multipart endpoints write each upload to a per-request `tempfile.TemporaryDirectory` and pass that as the only `image_paths` entry. The directory is auto-deleted when the handler returns — the sidecar holds **no** persistent asset state. If a YAML references an image that wasn't uploaded, WireViz raises and the sidecar returns 422 with the missing filename in `detail` so the UI can surface it.

## Conventions

- **Don't import from `wireviz` package root.** `__init__.py` is deliberately bare (only exports `__version__` and a few constants). Import `parse` from `wireviz.wireviz` and `Harness`/`read_yaml_from_png` from `wireviz.Harness`.
- **Don't add `public.*` runtime config for the sidecar URL.** The browser must talk to `/api/wireviz/*`, never to the sidecar directly. Adding a public mirror leaks the address into the client bundle and breaks the production CORS story.
- **Don't write rendered files to disk in the sidecar.** Always `output_formats=None`, `return_types="harness"`, then `_render` for in-memory output. The sidecar is stateless.
- **Keep error envelopes thin.** FastAPI `HTTPException(detail=...)` propagates to `err.data.detail` in the browser; the UI renders that verbatim. Don't wrap it in extra layers.
- **Run the smoke tests after any engine bump.** `pnpm test:sidecar` catches most signature/contract drift in `wireviz.parse()` and `Harness._render`.
