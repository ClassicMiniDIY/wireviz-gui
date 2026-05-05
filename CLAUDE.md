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

# Tests (5 smoke tests: health, parse pipeline, PNG round-trip, error path)
pnpm test:sidecar
sidecar/.venv/bin/pytest sidecar/tests/test_smoke.py::test_png_round_trip_via_extract  # one test

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

### Frontend (`frontend/`)

- **`app/app.vue`** — the entire UI: textarea editor on the left, SVG preview on the right, `⌘⏎` / `Ctrl⏎` to render, "Open .png" file input that posts the PNG up for YAML extraction. Uses `useFetch` for the health probe and `$fetch` for parse/extract.
- **`nuxt.config.ts`** — `runtimeConfig.sidecarUrl` (server-only, no `public.*` mirror — keeping the URL out of the browser bundle is intentional).
- **`server/api/wireviz/{parse,extract,health}.*.ts`** — thin proxies to the sidecar. `parse.post.ts` forwards JSON; `extract.post.ts` rebuilds the multipart upload as a `FormData` before forwarding; `health.get.ts` is a passthrough that converts a sidecar timeout into a `503`. All three convert sidecar errors into `createError({ data: { detail } })` so `err.data.detail` reaches the UI verbatim.

### Sidecar (`sidecar/wireviz_gui_sidecar/`)

- **`app.py`** — FastAPI surface. The endpoints all funnel through one strategy: `wireviz.parse(return_types="harness")` to get the in-memory `Harness`, then `harness._render((fmt, ...), yaml_source=...)` to produce bytes/strings. `bom_rows = harness.bom()` is included separately so the UI doesn't have to parse TSV.
- **`__main__.py`** — uvicorn entrypoint, exposed as the `wireviz-gui-sidecar` console script. Reads `WIREVIZ_GUI_HOST` / `WIREVIZ_GUI_PORT` env vars.
- **`tests/test_smoke.py`** — uses FastAPI's `TestClient` against the real WireViz engine (no mocks) so engine-API drift is caught here first.

## Load-bearing engine contracts

These three behaviors come from the engine repo and **must** stay correct for the GUI to work. If the sidecar tests start failing after an engine bump, this is where to look.

1. **`wireviz.parse()` is the only public entry — never shell out to the `wireviz` CLI.** The CLI (`wv_cli.py`) is a thin Click wrapper; the GUI must drive the library directly so errors are structured exceptions, not stderr scraping.

2. **PNG embedding only happens via `Harness._render`.** The engine has two PNG paths:
   - `harness.png` (the property used by `parse(return_types="png")`) does **NOT** embed YAML.
   - `harness._render(("png",), yaml_source=...)` embeds the YAML in a `wireviz:yaml` iTXt chunk.

   The sidecar always uses `_render` so PNGs round-trip. `_render` returns `{fmt: bytes|str}` — binary formats (`png`) are bytes, text formats (`svg`, `html`, `gv`, `tsv`) are str. Don't break that contract.

3. **PNG → YAML round-trip via `read_yaml_from_png`.** Imported from `wireviz.Harness`. The "Open .png" button relies on this. If a user uploads a PNG that wasn't rendered with `embed_yaml=True`, the sidecar returns 404 — that's intentional, not a bug.

## Conventions

- **Don't import from `wireviz` package root.** `__init__.py` is deliberately bare (only exports `__version__` and a few constants). Import `parse` from `wireviz.wireviz` and `Harness`/`read_yaml_from_png` from `wireviz.Harness`.
- **Don't add `public.*` runtime config for the sidecar URL.** The browser must talk to `/api/wireviz/*`, never to the sidecar directly. Adding a public mirror leaks the address into the client bundle and breaks the production CORS story.
- **Don't write rendered files to disk in the sidecar.** Always `output_formats=None`, `return_types="harness"`, then `_render` for in-memory output. The sidecar is stateless.
- **Keep error envelopes thin.** FastAPI `HTTPException(detail=...)` propagates to `err.data.detail` in the browser; the UI renders that verbatim. Don't wrap it in extra layers.
- **Run the smoke tests after any engine bump.** `pnpm test:sidecar` catches most signature/contract drift in `wireviz.parse()` and `Harness._render`.
