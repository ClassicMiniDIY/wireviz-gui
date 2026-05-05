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
- Asset path resolution: when the YAML references images via
  ``image: src: foo.png``, WireViz resolves those paths against the
  directories passed in ``image_paths``. The multipart endpoints below
  spool uploads into a per-request ``TemporaryDirectory`` and pass that
  as ``image_paths`` so user-supplied images can be picked up by the
  engine without the sidecar persisting any state across requests.
"""

from __future__ import annotations

import base64
import io
import logging
import tempfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
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


def _do_parse(
    yaml_src: str,
    formats: list[str],
    embed_yaml: bool,
    image_paths: list[str] | None = None,
) -> ParseResponse:
    """Shared parse pipeline used by both the JSON and multipart endpoints.

    Strategy: get a Harness from parse(), then drive Harness._render
    for every requested format. _render is the only path that honors
    yaml_source for the PNG iTXt embed (the harness.png property used
    by parse(return_types='png') skips it), and it gives us the
    {fmt: bytes|str} dict-shape contract for free.
    """
    bad = [f for f in formats if f not in _VALID_FORMATS]
    if bad:
        raise HTTPException(400, f"Unsupported formats: {bad}")

    try:
        harness: Harness = wireviz_parse(
            yaml_src,
            return_types="harness",
            output_formats=None,
            output_name="harness",
            embed_yaml=embed_yaml,
            image_paths=list(image_paths or []),
        )
    except Exception as exc:
        log.exception("wireviz.parse failed")
        raise HTTPException(422, f"WireViz parse error: {exc}") from exc

    rendered: dict[str, Any] = harness._render(
        tuple(formats),
        output_dir=None,
        output_name="harness",
        yaml_source=yaml_src if embed_yaml else None,
    )

    try:
        bom_rows = harness.bom()
    except Exception:
        bom_rows = None

    png_bytes = rendered.get("png")
    return ParseResponse(
        svg=rendered.get("svg"),
        png_base64=base64.b64encode(png_bytes).decode("ascii") if png_bytes else None,
        tsv=rendered.get("tsv"),
        html=rendered.get("html"),
        gv=rendered.get("gv"),
        bom=bom_rows,
    )


def _do_render_one(
    yaml_src: str,
    fmt: str,
    embed_yaml: bool,
    image_paths: list[str] | None = None,
) -> Any:
    try:
        harness: Harness = wireviz_parse(
            yaml_src,
            return_types="harness",
            output_name="harness",
            embed_yaml=embed_yaml,
            image_paths=list(image_paths or []),
        )
    except Exception as exc:
        raise HTTPException(422, f"WireViz parse error: {exc}") from exc
    out = harness._render(
        (fmt,),
        output_name="harness",
        yaml_source=yaml_src if embed_yaml else None,
    )
    return out[fmt]


def _spool_assets_to_tempdir(files: list[UploadFile]) -> tempfile.TemporaryDirectory:
    """Write each uploaded asset to a fresh per-request tempdir.

    Returns the ``TemporaryDirectory`` so the caller is responsible for
    keeping it alive for the duration of the parse — when it goes out of
    scope the directory and its contents are deleted automatically.

    We use the upload's filename verbatim so the YAML's ``image: src:``
    paths line up against the directory contents. Paths are sanitised
    to a basename (no traversal) and rejected if the resulting name is
    empty.
    """
    td = tempfile.TemporaryDirectory(prefix="wireviz-gui-")
    for upload in files:
        name = Path(upload.filename or "").name
        if not name:
            raise HTTPException(400, "Asset upload missing a filename.")
        target = Path(td.name) / name
        target.write_bytes(upload.file.read())
    return td


def create_app() -> FastAPI:
    app = FastAPI(
        title="wireviz-gui sidecar",
        version="0.2.0",
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
        from wireviz import __version__ as wv_version

        return {"status": "ok", "wireviz": wv_version}

    @app.post("/parse", response_model=ParseResponse)
    def parse_yaml(req: ParseRequest) -> ParseResponse:
        """JSON parse — kept for the simple no-asset case and for sidecar
        smoke tests. The frontend uses ``/parse-multipart`` so it can
        attach images alongside the YAML."""
        return _do_parse(req.yaml, req.formats, req.embed_yaml)

    @app.post("/parse-multipart", response_model=ParseResponse)
    async def parse_yaml_multipart(
        yaml: str = Form(...),
        formats: list[str] = Form(default=["svg"]),
        embed_yaml: bool = Form(default=True),
        files: list[UploadFile] = File(default=[]),
    ) -> ParseResponse:
        """Multipart parse with asset uploads.

        Each ``files`` entry is written to a per-request tempdir under
        its (sanitised) basename, and that tempdir is passed to WireViz
        as ``image_paths`` so YAML like ``image: src: foo.png`` resolves
        against the user's uploads. The tempdir is deleted as soon as
        this handler returns.
        """
        with _spool_assets_to_tempdir(files) as tmpdir:
            return _do_parse(yaml, formats, embed_yaml, image_paths=[tmpdir])

    @app.post("/render/svg", response_class=Response)
    def render_svg(req: ParseRequest) -> Response:
        """Direct SVG endpoint — useful when the GUI just needs the diagram
        and doesn't want the JSON envelope. Returns image/svg+xml bytes."""
        return Response(
            content=_do_render_one(req.yaml, "svg", embed_yaml=False),
            media_type="image/svg+xml",
        )

    @app.post("/render/png", response_class=Response)
    def render_png(req: ParseRequest) -> Response:
        return Response(
            content=_do_render_one(req.yaml, "png", embed_yaml=req.embed_yaml),
            media_type="image/png",
        )

    @app.post("/render/svg-multipart", response_class=Response)
    async def render_svg_multipart(
        yaml: str = Form(...),
        files: list[UploadFile] = File(default=[]),
    ) -> Response:
        with _spool_assets_to_tempdir(files) as tmpdir:
            return Response(
                content=_do_render_one(
                    yaml, "svg", embed_yaml=False, image_paths=[tmpdir]
                ),
                media_type="image/svg+xml",
            )

    @app.post("/render/png-multipart", response_class=Response)
    async def render_png_multipart(
        yaml: str = Form(...),
        embed_yaml: bool = Form(default=True),
        files: list[UploadFile] = File(default=[]),
    ) -> Response:
        with _spool_assets_to_tempdir(files) as tmpdir:
            return Response(
                content=_do_render_one(
                    yaml, "png", embed_yaml=embed_yaml, image_paths=[tmpdir]
                ),
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
