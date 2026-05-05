"""FastAPI surface that wraps the WireViz 0.5.0 Python API for the GUI.

Design notes (load-bearing — see /Users/colegentry/Development/WireViz/CLAUDE.md):

- The single public entry into the engine is ``wireviz.parse()``. We never
  shell out to the ``wireviz`` CLI from here; the GUI must drive the library
  programmatically so error context is structured rather than scraped from
  stdout/stderr.
- ``parse(return_types=...)`` gives us in-memory bytes/strings without ever
  touching disk, which matches ``Harness._render``'s dict-shape contract:
  binary formats (png) are bytes, text formats (svg/html/gv/tsv) are str.
- PNG round-trip: ``embed_yaml=True`` (default) writes the source YAML into a
  ``wireviz:yaml`` iTXt chunk. ``read_yaml_from_png`` extracts it back. The
  GUI uses this to "open" a previously-rendered PNG and recover its source.
"""

from __future__ import annotations

import io
import logging
from typing import Any

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from wireviz.wireviz import parse as wireviz_parse
from wireviz.Harness import Harness, read_yaml_from_png

log = logging.getLogger("wireviz_gui_sidecar")


class ParseRequest(BaseModel):
    yaml: str = Field(..., description="Raw WireViz YAML source")
    formats: list[str] = Field(
        default_factory=lambda: ["svg", "png", "tsv"],
        description="Subset of {svg, png, tsv, html, gv}. BOM is the 'tsv' format.",
    )
    embed_yaml: bool = Field(
        True,
        description="When True, embed YAML source in PNG iTXt for round-trip.",
    )


class ParseResponse(BaseModel):
    svg: str | None = None
    png_base64: str | None = None
    tsv: str | None = None
    html: str | None = None
    gv: str | None = None
    bom: list[dict[str, Any]] | None = None


_VALID_FORMATS = {"svg", "png", "tsv", "html", "gv"}


def create_app() -> FastAPI:
    app = FastAPI(
        title="wireviz-gui sidecar",
        version="0.1.0",
        description="HTTP wrapper around wireviz.parse() for the Nuxt frontend.",
    )

    # The Nuxt dev server runs on a different port; allow it to call us
    # directly during development. In production the frontend proxies
    # through Nitro server routes so CORS doesn't fire.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        from wireviz import __version__ as wv_version  # exported from package __init__

        return {"status": "ok", "wireviz": wv_version}

    @app.post("/parse", response_model=ParseResponse)
    def parse_yaml(req: ParseRequest) -> ParseResponse:
        bad = [f for f in req.formats if f not in _VALID_FORMATS]
        if bad:
            raise HTTPException(400, f"Unsupported formats: {bad}")

        # Strategy: get a Harness from parse(), then drive Harness._render
        # for every requested format. This gives us the dict-shape contract
        # ({fmt: bytes|str}) for free, and — critically — _render is the
        # only path that honors ``yaml_source`` to embed YAML in PNG.
        # ``harness.png`` (the property used by parse(return_types="png"))
        # skips the iTXt embed.
        try:
            harness: Harness = wireviz_parse(
                req.yaml,
                return_types="harness",
                output_formats=None,  # never write files
                output_name="harness",  # required when inp is a string
                embed_yaml=req.embed_yaml,
            )
        except Exception as exc:
            log.exception("wireviz.parse failed")
            raise HTTPException(422, f"WireViz parse error: {exc}") from exc

        rendered: dict[str, Any] = harness._render(
            tuple(req.formats),
            output_dir=None,
            output_name="harness",
            yaml_source=req.yaml if req.embed_yaml else None,
        )

        try:
            bom_rows = harness.bom()
        except Exception:
            bom_rows = None

        import base64

        png_bytes = rendered.get("png")
        return ParseResponse(
            svg=rendered.get("svg"),
            png_base64=base64.b64encode(png_bytes).decode("ascii") if png_bytes else None,
            tsv=rendered.get("tsv"),
            html=rendered.get("html"),
            gv=rendered.get("gv"),
            bom=bom_rows,
        )

    def _render_one(yaml_src: str, fmt: str, embed_yaml: bool) -> Any:
        try:
            harness: Harness = wireviz_parse(
                yaml_src,
                return_types="harness",
                output_name="harness",
                embed_yaml=embed_yaml,
            )
        except Exception as exc:
            raise HTTPException(422, f"WireViz parse error: {exc}") from exc
        out = harness._render(
            (fmt,),
            output_name="harness",
            yaml_source=yaml_src if embed_yaml else None,
        )
        return out[fmt]

    @app.post("/render/svg", response_class=Response)
    def render_svg(req: ParseRequest) -> Response:
        """Direct SVG endpoint — useful when the GUI just needs the diagram
        and doesn't want the JSON envelope. Returns image/svg+xml bytes."""
        return Response(
            content=_render_one(req.yaml, "svg", embed_yaml=False),
            media_type="image/svg+xml",
        )

    @app.post("/render/png", response_class=Response)
    def render_png(req: ParseRequest) -> Response:
        return Response(
            content=_render_one(req.yaml, "png", embed_yaml=req.embed_yaml),
            media_type="image/png",
        )

    @app.post("/extract")
    async def extract_yaml(file: UploadFile = File(...)) -> JSONResponse:
        """Extract the YAML source embedded in a previously-rendered PNG.

        Relies on the ``wireviz:yaml`` iTXt chunk written by
        ``_embed_yaml_in_png`` during a render with ``embed_yaml=True``.
        """
        data = await file.read()
        try:
            yaml_source = read_yaml_from_png(io.BytesIO(data))
        except Exception as exc:
            raise HTTPException(400, f"Failed to read PNG: {exc}") from exc
        if yaml_source is None:
            raise HTTPException(
                404,
                "No wireviz:yaml chunk in PNG — was it rendered with embed_yaml=True?",
            )
        return JSONResponse({"yaml": yaml_source})

    return app


app = create_app()
