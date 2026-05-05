"""Smoke tests that exercise the sidecar against the real wireviz engine."""

from __future__ import annotations

import base64
import io

import pytest
from fastapi.testclient import TestClient

from wireviz_gui_sidecar.app import create_app


SIMPLE_YAML = """\
connectors:
  X1:
    type: D-Sub
    subtype: female
    pinlabels: [DCD, RX, TX, DTR, GND, DSR, RTS, CTS, RI]
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
    - X1: [5,2,3]
    - W1: [1,2,3]
    - X2: [1,3,2]
  -
    - X1: 5
    - W1: s
"""


@pytest.fixture
def client():
    return TestClient(create_app())


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "wireviz" in body


def test_parse_returns_svg_png_and_bom(client):
    r = client.post("/parse", json={"yaml": SIMPLE_YAML, "formats": ["svg", "png", "tsv"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["svg"].lstrip().startswith("<")
    assert "png_base64" in body and body["png_base64"]
    assert body["tsv"] and "\t" in body["tsv"]


def test_png_round_trip_via_extract(client):
    # Render with embedded YAML, then post the PNG bytes back to /extract.
    r = client.post("/render/png", json={"yaml": SIMPLE_YAML, "embed_yaml": True})
    assert r.status_code == 200
    png_bytes = r.content
    files = {"file": ("harness.png", io.BytesIO(png_bytes), "image/png")}
    r2 = client.post("/extract", files=files)
    assert r2.status_code == 200
    assert "connectors:" in r2.json()["yaml"]


def test_extract_404_on_unembedded_png(client):
    r = client.post("/render/png", json={"yaml": SIMPLE_YAML, "embed_yaml": False})
    assert r.status_code == 200
    files = {"file": ("plain.png", io.BytesIO(r.content), "image/png")}
    r2 = client.post("/extract", files=files)
    assert r2.status_code == 404


def test_parse_surfaces_user_yaml_errors(client):
    r = client.post("/parse", json={"yaml": "not: [valid wireviz", "formats": ["svg"]})
    assert r.status_code in (400, 422)
