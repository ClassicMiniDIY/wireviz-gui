# CLAUDE.md

Guidance for Claude Code when working in this repo. The companion engine repo at `/Users/colegentry/Development/WireViz` has its own `CLAUDE.md` with deeper engine context — read it before changing anything that crosses the API boundary.

## What this is

A two-process app that turns WireViz YAML into harness diagrams interactively:

- **`frontend/`** — Nuxt 4 (compatibilityDate `2025-07-15`). Renders the editor + diagram preview. Has Nitro server routes under `server/api/wireviz/*` that proxy to the sidecar so the sidecar URL never reaches the browser bundle and CORS is a non-issue in production.
- **`sidecar/`** — Python FastAPI service (`wireviz_gui_sidecar`) that imports WireViz 0.5.0 as a library and exposes `/parse`, `/render/{svg,png}`, `/extract`, `/health`. Listens on `127.0.0.1:8765` by default.

The sidecar pins WireViz via a local `file://` install (`/Users/colegentry/Development/WireViz`). When the engine repo changes, the sidecar picks it up automatically because the install is editable.

## Load-bearing engine details (do not regress)

These three things from the engine repo's `CLAUDE.md` are **load-bearing** for this GUI. If you change the sidecar, you have to keep them working:

1. **Always go through `wireviz.wireviz.parse()`.** Never shell out to the `wireviz` CLI. The CLI (`wv_cli.py`) is a thin Click wrapper; the GUI must drive the library directly so errors surface as structured exceptions, not stderr scraping.

2. **Use `Harness._render` for everything that needs YAML embedding.** The engine has two PNG paths:
   - `harness.png` (the property used by `parse(return_types="png")`) — does **NOT** embed YAML.
   - `harness._render(("png",), yaml_source=...)` — embeds the YAML in a `wireviz:yaml` iTXt chunk.

   The sidecar's `/parse` and `/render/png` go through `_render` so PNGs round-trip. The dict-shape contract is `{fmt: bytes|str}` — binary formats (`png`) are bytes, text formats (`svg`, `html`, `gv`, `tsv`) are str. Don't break that assumption.

3. **PNG round-trip via the iTXt chunk.** Rendered PNGs carry their own source. `read_yaml_from_png` (imported from `wireviz.Harness`) extracts it. The "Open .png…" button in the UI relies on this. If a user uploads a PNG that wasn't rendered with `embed_yaml=True`, the sidecar returns 404 — that's intentional, not a bug.

## Commands

```bash
# First-time setup (creates sidecar/.venv via uv, runs pnpm install)
pnpm setup:sidecar
pnpm setup:frontend

# Day-to-day: starts both processes side-by-side via concurrently
pnpm dev

# Just one or the other
pnpm dev:sidecar     # sidecar with --reload on :8765
pnpm dev:frontend    # nuxt dev on :3000

# Sidecar tests (5 smoke tests including PNG round-trip)
pnpm test:sidecar

# Production build of the frontend
pnpm build
```

The sidecar venv lives at `sidecar/.venv` and is created with Python 3.12 via `uv`. WireViz itself is installed as `wireviz @ file:///Users/colegentry/Development/WireViz` — if you move the engine checkout, edit `sidecar/pyproject.toml` and re-run `pnpm setup:sidecar`.

`graphviz` (the `dot` binary) must be on `PATH`. The sidecar shells out via the `graphviz` Python package, which calls `dot` directly.

## Architecture quick reference

```
frontend/
  app/app.vue                    Editor + preview UI (single page, no router yet)
  nuxt.config.ts                 runtimeConfig.sidecarUrl — server-only
  server/api/wireviz/
    parse.post.ts                Proxies POST /parse JSON → sidecar
    extract.post.ts              Proxies multipart PNG upload → sidecar /extract
    health.get.ts                Health probe

sidecar/
  pyproject.toml                 Installs wireviz from local file:// path
  wireviz_gui_sidecar/app.py     FastAPI surface; ALL rendering goes via _render
  wireviz_gui_sidecar/__main__.py  uvicorn entrypoint
  tests/test_smoke.py            5 tests: health, parse, PNG round-trip, error path
```

## Conventions

- **Don't add a public.* mirror of `sidecarUrl`** in `nuxt.config.ts`. The URL is server-only on purpose. The UI talks to `/api/wireviz/*`, never the sidecar directly.
- **Don't import from `wireviz` package root** — it's deliberately bare (`__init__.py` only exports `__version__` and a few constants). Import `parse` from `wireviz.wireviz` and `Harness`/`read_yaml_from_png` from `wireviz.Harness`.
- **Don't write rendered files to disk in the sidecar.** Always use `output_formats=None` and `return_types="harness"`, then call `_render` for in-memory bytes/strings. The sidecar is stateless and shouldn't accumulate scratch files.
- **Mirror engine API changes here.** When `wireviz.parse()` or `Harness._render` change signatures upstream, the sidecar's `/parse` is the first thing that breaks. The five smoke tests will catch most of it; run them after any engine bump.
- **Keep error envelopes structured.** FastAPI's `HTTPException(detail=...)` flows through to the browser as `err.data.detail`. The frontend renders that verbatim in the error pane — don't wrap it in extra layers.
