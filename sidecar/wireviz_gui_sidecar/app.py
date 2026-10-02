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
- Untrusted input: every YAML that reaches this service comes from a
  browser, so every ``wireviz_parse(...)`` call passes ``untrusted=True``.
  In that mode the engine treats a str input only as YAML text (never as a
  path), accepts only relative ``image.src`` paths that resolve inside
  ``image_paths``, refuses ``tweak``, sanitizes the SVG and HTML output and
  puts a timeout on Graphviz. ``Harness.untrusted`` carries the flag, so
  ``harness._render(...)`` applies the output rules too. Engine error
  messages still go back to the user verbatim (they need them to fix their
  YAML); in untrusted mode they cannot contain the content of server files.
- Size limits: ``BodySizeLimitMiddleware`` rejects any request body larger
  than ``MAX_REQUEST_BYTES`` with 413, before or while it streams in. The
  YAML is capped at ``MAX_YAML_BYTES`` and the uploads at
  ``MAX_UPLOAD_FILES`` files and ``MAX_UPLOAD_BYTES`` in total, all 413.
  Uploads are copied to disk in chunks through a byte counter, never read
  into memory in full.
"""

from __future__ import annotations

import base64
import io
import logging
import shutil
import tempfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from wireviz.wireviz import parse as wireviz_parse
from wireviz.Harness import Harness, read_yaml_from_png

log = logging.getLogger("wireviz_gui_sidecar")

# Request size limits. MAX_YAML_BYTES matches the engine's
# UNTRUSTED_MAX_INPUT_BYTES; checking it here gives the user a 413 instead
# of the engine's 422.
MAX_YAML_BYTES = 1_000_000
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_UPLOAD_FILES = 50
# Whole request body: YAML + uploads + 1 MiB for multipart framing and
# the small form fields.
MAX_REQUEST_BYTES = MAX_YAML_BYTES + MAX_UPLOAD_BYTES + 1024 * 1024


class BodySizeLimitMiddleware:
    """Reject HTTP request bodies larger than ``max_bytes`` with 413.

    A declared ``Content-Length`` above the limit is refused before the
    body is read. Bodies without one (chunked) are counted while they
    stream in; the HTTPException raised from ``receive`` reaches FastAPI's
    exception handler, which answers 413.
    """

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        detail = f"Request body is larger than the limit of {self.max_bytes} bytes"
        for name, value in scope.get("headers", []):
            if name == b"content-length" and value.isdigit():
                if int(value) > self.max_bytes:
                    await JSONResponse({"detail": detail}, status_code=413)(
                        scope, receive, send
                    )
                    return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise HTTPException(413, detail)
            return message

        await self.app(scope, limited_receive, send)


def _check_yaml_size(yaml_src: str) -> None:
    size = len(yaml_src.encode("utf-8"))
    if size > MAX_YAML_BYTES:
        raise HTTPException(
            413, f"YAML is {size} bytes; the limit is {MAX_YAML_BYTES} bytes"
        )


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
    _check_yaml_size(yaml_src)

    harness = _parse_untrusted(yaml_src, embed_yaml, image_paths)
    rendered: dict[str, Any] = _render_untrusted(
        harness, tuple(formats), yaml_src if embed_yaml else None
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
    _check_yaml_size(yaml_src)
    harness = _parse_untrusted(yaml_src, embed_yaml, image_paths)
    out = _render_untrusted(harness, (fmt,), yaml_src if embed_yaml else None)
    return out[fmt]


def _parse_untrusted(
    yaml_src: str, embed_yaml: bool, image_paths: list[str] | None
) -> Harness:
    """The only place the sidecar calls ``wireviz.parse()``.

    ``untrusted=True`` is mandatory: the YAML comes from a browser. The
    engine's message goes back to the user (422) so they can fix the YAML.
    """
    try:
        return wireviz_parse(
            yaml_src,
            return_types="harness",
            output_formats=None,
            output_name="harness",
            embed_yaml=embed_yaml,
            image_paths=list(image_paths or []),
            untrusted=True,
        )
    except Exception as exc:
        log.exception("wireviz.parse failed")
        raise HTTPException(422, f"WireViz parse error: {exc}") from exc


def _render_untrusted(
    harness: Harness, formats: tuple[str, ...], yaml_source: str | None
) -> dict[str, Any]:
    """Render in memory. ``harness.untrusted`` is True, so the engine
    sanitizes SVG/HTML and puts a timeout on Graphviz. Those checks raise
    ValueError (or a timeout error), which the user sees as 422."""
    try:
        return harness._render(
            formats,
            output_dir=None,
            output_name="harness",
            yaml_source=yaml_source,
        )
    except Exception as exc:
        log.exception("Harness._render failed")
        raise HTTPException(422, f"WireViz render error: {exc}") from exc


def _spool_assets_to_tempdir(files: list[UploadFile]) -> tempfile.TemporaryDirectory:
    """Write each uploaded asset to a fresh per-request tempdir.

    Returns the ``TemporaryDirectory`` so the caller is responsible for
    keeping it alive for the duration of the parse — when it goes out of
    scope the directory and its contents are deleted automatically.

    We use the upload's filename verbatim so the YAML's ``image: src:``
    paths line up against the directory contents. Paths are sanitised
    to a basename (no traversal) and rejected if the resulting name is
    empty.

    More than ``MAX_UPLOAD_FILES`` files, or more than ``MAX_UPLOAD_BYTES``
    in total, is refused with 413 and the tempdir is removed.
    """
    if len(files) > MAX_UPLOAD_FILES:
        raise HTTPException(
            413, f"{len(files)} files uploaded; the limit is {MAX_UPLOAD_FILES}"
        )
    td = tempfile.TemporaryDirectory(prefix="wireviz-gui-")
    budget = _UploadBudget(MAX_UPLOAD_BYTES)
    try:
        for upload in files:
            name = Path(upload.filename or "").name
            if not name:
                raise HTTPException(400, "Asset upload missing a filename.")
            target = Path(td.name) / name
            # Stream the upload to disk in chunks rather than .read()ing the
            # full payload into memory first. The counting writer stops the
            # copy as soon as the total passes the limit.
            with target.open("wb") as fh:
                shutil.copyfileobj(upload.file, _CountingWriter(fh, budget))
    except BaseException:
        td.cleanup()
        raise
    return td


class _UploadBudget:
    """Byte budget shared by every upload in one request."""

    def __init__(self, limit: int) -> None:
        self.limit = limit
        self.used = 0

    def spend(self, n: int) -> None:
        self.used += n
        if self.used > self.limit:
            raise HTTPException(
                413, f"Uploads are larger than the limit of {self.limit} bytes"
            )


class _CountingWriter:
    """File wrapper that charges every write against an ``_UploadBudget``."""

    def __init__(self, fh: Any, budget: _UploadBudget) -> None:
        self._fh = fh
        self._budget = budget

    def write(self, data: bytes) -> int:
        self._budget.spend(len(data))
        return self._fh.write(data)


def create_app() -> FastAPI:
    app = FastAPI(
        title="wireviz-gui sidecar",
        version="0.2.0",
        description="HTTP wrapper around wireviz.parse() for the Nuxt frontend.",
    )

    app.add_middleware(BodySizeLimitMiddleware, max_bytes=MAX_REQUEST_BYTES)

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
        ``read_yaml_from_png`` reads only the raw PNG chunks (no pixel
        decode) and raises ValueError for data that is not a PNG; that
        is a 400.
        """
        data = await file.read(MAX_UPLOAD_BYTES + 1)
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                413, f"PNG is larger than the limit of {MAX_UPLOAD_BYTES} bytes"
            )
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
