"""Untrusted-input contract: the sidecar renders YAML that anyone can send.

Every test here pins one rule from the engine's ``parse(untrusted=True)``
mode or one of the sidecar's own request-size limits. See the module
docstring of ``wireviz_gui_sidecar.app`` and the repo CLAUDE.md.
"""

from __future__ import annotations

import tempfile
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from wireviz_gui_sidecar import app as sidecar_app
from wireviz_gui_sidecar.app import create_app

from test_smoke import SIMPLE_YAML, TINY_PNG


@pytest.fixture
def client():
    return TestClient(create_app())


def _image_yaml(src: str) -> str:
    return f"""\
connectors:
  X1:
    pincount: 1
    image:
      src: {src}
cables:
  W1:
    wirecount: 1
    length: 0.1
connections:
  -
    - X1: 1
    - W1: 1
"""


# ---- (a) a str body is YAML text, never a path --------------------------


def test_yaml_body_naming_a_server_file_is_not_read(client, tmp_path):
    marker = f"SECRET-{uuid.uuid4().hex}"
    secret = tmp_path / "secret.yml"
    # A valid harness: if the engine read this path, the render would
    # succeed and the marker would appear in the SVG.
    secret.write_text(SIMPLE_YAML.replace("D-Sub", marker))

    r = client.post("/parse", json={"yaml": str(secret), "formats": ["svg"]})

    assert r.status_code == 422, r.text
    assert marker not in r.text


# ---- (b) image.src must be relative and inside image_paths --------------


def test_etc_hosts_image_src_is_refused(client):
    r = client.post(
        "/parse-multipart",
        data={"yaml": _image_yaml("/etc/hosts"), "formats": "svg"},
    )
    assert r.status_code == 422, r.text
    assert "localhost" not in r.text


@pytest.mark.parametrize("endpoint", ["/parse", "/parse-multipart"])
def test_absolute_image_src_is_refused(client, tmp_path, endpoint):
    # A real PNG at an absolute server path: without the untrusted rules
    # the engine reads it and inlines it into the SVG.
    secret = tmp_path / "server-side.png"
    secret.write_bytes(TINY_PNG)
    yaml = _image_yaml(str(secret))
    if endpoint == "/parse":
        r = client.post(endpoint, json={"yaml": yaml, "formats": ["svg"]})
    else:
        r = client.post(endpoint, data={"yaml": yaml, "formats": "svg"})
    assert r.status_code == 422, r.text
    assert "must be relative" in r.json()["detail"]
    assert "data:image/png;base64," not in r.text


def test_image_src_traversal_out_of_upload_dir_is_refused(client):
    # Put a real PNG next to the per-request tempdir (both live in the
    # system temp dir). Without the untrusted rules, `../<name>` resolves
    # to it and the engine inlines it into the SVG.
    name = f"wireviz-gui-outside-{uuid.uuid4().hex}.png"
    outside = Path(tempfile.gettempdir()) / name
    outside.write_bytes(TINY_PNG)
    try:
        r = client.post(
            "/parse-multipart",
            data={"yaml": _image_yaml(f"../{name}"), "formats": "svg"},
            files=[("files", ("unrelated.png", TINY_PNG, "image/png"))],
        )
    finally:
        outside.unlink()
    assert r.status_code == 422, r.text
    assert "data:image/png;base64," not in r.text


# ---- (c) tweak is refused -----------------------------------------------


def test_global_tweak_is_refused(client):
    yaml = SIMPLE_YAML + "\ntweak:\n  append: 'node [shape=box]'\n"
    r = client.post("/parse", json={"yaml": yaml, "formats": ["svg"]})
    assert r.status_code == 422, r.text
    assert "tweak" in r.json()["detail"]


def test_per_node_tweak_is_refused(client):
    yaml = SIMPLE_YAML.replace(
        "    type: Molex KK 254\n",
        "    type: Molex KK 254\n    tweak:\n      append: 'x'\n",
    )
    r = client.post("/parse", json={"yaml": yaml, "formats": ["svg"]})
    assert r.status_code == 422, r.text
    assert "tweak" in r.json()["detail"]


# ---- (d) SVG output is sanitized ---------------------------------------


XSS_YAML = """\
connectors:
  X1:
    pincount: 1
    notes: '<font face="x&quot; onload=&quot;alert(1)">n</font>'
  X2:
    pincount: 1
    notes: '<table><tr><td href="javascript:alert(2)">click</td></tr></table>'
connections: [[X1], [X2]]
"""


@pytest.mark.parametrize(
    "path,body",
    [
        ("/parse", {"json": {"yaml": XSS_YAML, "formats": ["svg"]}}),
        ("/parse-multipart", {"data": {"yaml": XSS_YAML, "formats": "svg"}}),
        ("/render/svg", {"json": {"yaml": XSS_YAML}}),
    ],
)
def test_svg_has_no_script_vectors(client, path, body):
    # Without untrusted mode Graphviz copies the font face unescaped, so
    # the raw SVG carries onload= and a javascript: link.
    r = client.post(path, **body)
    assert r.status_code == 200, r.text
    svg = r.json()["svg"] if path != "/render/svg" else r.text
    assert "<svg" in svg
    lowered = svg.lower()
    assert "onload" not in lowered
    assert "javascript:" not in lowered


# ---- (e) size limits ----------------------------------------------------


def test_oversize_yaml_is_413(client):
    yaml = "# " + "x" * sidecar_app.MAX_YAML_BYTES + "\n" + SIMPLE_YAML
    r = client.post("/parse", json={"yaml": yaml, "formats": ["svg"]})
    assert r.status_code == 413, r.text


def test_oversize_request_body_is_413_from_content_length(monkeypatch):
    monkeypatch.setattr(sidecar_app, "MAX_REQUEST_BYTES", 10_000)
    client = TestClient(create_app())
    r = client.post(
        "/parse", json={"yaml": SIMPLE_YAML + "#" * 20_000, "formats": ["svg"]}
    )
    assert r.status_code == 413, r.text


def test_oversize_chunked_body_is_413(monkeypatch):
    # No Content-Length: the middleware must count bytes as they stream.
    monkeypatch.setattr(sidecar_app, "MAX_REQUEST_BYTES", 10_000)
    client = TestClient(create_app())

    def chunks():
        yield b'{"yaml": "'
        for _ in range(50):
            yield b"#" * 1000
        yield b'", "formats": ["svg"]}'

    r = client.post(
        "/parse", content=chunks(), headers={"content-type": "application/json"}
    )
    assert r.status_code == 413, r.text


def test_too_many_upload_files_is_413(client, monkeypatch):
    monkeypatch.setattr(sidecar_app, "MAX_UPLOAD_FILES", 3)
    files = [("files", (f"f{i}.png", TINY_PNG, "image/png")) for i in range(4)]
    r = client.post(
        "/parse-multipart", data={"yaml": SIMPLE_YAML, "formats": "svg"}, files=files
    )
    assert r.status_code == 413, r.text


def test_oversize_upload_total_is_413(client, monkeypatch):
    monkeypatch.setattr(sidecar_app, "MAX_UPLOAD_BYTES", 1000)
    files = [
        ("files", ("a.png", b"\0" * 600, "image/png")),
        ("files", ("b.png", b"\0" * 600, "image/png")),
    ]
    r = client.post(
        "/parse-multipart", data={"yaml": SIMPLE_YAML, "formats": "svg"}, files=files
    )
    assert r.status_code == 413, r.text


# ---- /extract -----------------------------------------------------------


def test_extract_non_png_is_400(client):
    r = client.post(
        "/extract", files={"file": ("x.png", b"not a png at all", "image/png")}
    )
    assert r.status_code == 400, r.text
