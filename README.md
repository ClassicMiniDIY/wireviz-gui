# wireviz-gui

A Nuxt 4 frontend + Python FastAPI sidecar that wraps [WireViz 0.5.0](https://github.com/ClassicMiniDIY/WireViz/releases/tag/v0.5.0) for interactive harness editing.

## Architecture

```
+--------------------+        HTTP (127.0.0.1:8765)        +-----------------------+
|  Nuxt 4 frontend   |  ---------- /parse, /extract -----> |  Python sidecar       |
|  (port 3000)       |                                     |  FastAPI + uvicorn    |
|                    |  <----- SVG / PNG / BOM / YAML ---- |  wraps wireviz.parse  |
+--------------------+                                     +-----------------------+
        |                                                          |
        | Nitro server routes proxy under /api/wireviz/*           | imports wireviz==0.5.0
        | so the sidecar URL never leaks to the browser bundle.    | from a local editable install
```

The sidecar is the only thing that loads the WireViz library. It exposes:

- `POST /parse` — JSON; YAML in, `{svg, png_base64, tsv, bom}` out
- `POST /parse-multipart` — multipart; YAML + N image uploads. Spools the uploads into a per-request tempdir, passes that as `image_paths` so `image: src: foo.png` references resolve.
- `POST /render/{svg,png}` and `/render/{svg,png}-multipart` — direct binary endpoints
- `POST /extract` — multipart PNG upload, returns the YAML embedded in its `wireviz:yaml` iTXt chunk
- `GET  /health` — version probe

All rendering goes through `Harness._render`, which is the only path in the engine that honors the `yaml_source` argument needed for PNG round-trip embedding. (The `harness.png` property used by `parse(return_types="png")` skips it.)

## Project bundles (.wvz)

A `.wvz` is a flat zip with `harness.yml` at the root plus any image files referenced by the YAML. Save with the **Save .wvz** button; open by dropping the file onto the editor or via the **Open…** picker. The frontend handles pack/unpack entirely client-side via JSZip.

PNG iTXt round-trip (rendered PNG carrying the YAML in its metadata) is the lighter-weight option for sharing a single rendered diagram. `.wvz` is the format when the project references images that need to come back too.

## Prerequisites

- **Graphviz** on `PATH` (`dot -V`)
- **Node 20+** with `pnpm`
- **Python 3.10+** with `uv` (or use a regular venv)
- A local checkout of WireViz at `/Users/colegentry/Development/WireViz` — the sidecar's `pyproject.toml` installs it via `file://` URL. Update the path if you cloned WireViz elsewhere.

## First-time setup

```bash
pnpm setup:sidecar    # creates sidecar/.venv and installs wireviz + FastAPI
pnpm setup:frontend   # pnpm install for Nuxt
```

## Run

```bash
pnpm dev    # starts both: sidecar on :8765, Nuxt on :3000
```

Then open http://localhost:3000.

## Test the sidecar

```bash
pnpm test:sidecar
```

Five smoke tests exercise the parse pipeline, both render endpoints, and the PNG → YAML round-trip.

## Pointing at a different WireViz

The sidecar's `pyproject.toml` pins the engine to a local path:

```toml
"wireviz @ file:///Users/colegentry/Development/WireViz"
```

To point at a different checkout (or a wheel), edit that line and re-run `pnpm setup:sidecar`.
