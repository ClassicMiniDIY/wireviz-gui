"""Entrypoint: ``python -m wireviz_gui_sidecar`` or ``wireviz-gui-sidecar``."""

from __future__ import annotations

import argparse
import os

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(prog="wireviz-gui-sidecar")
    parser.add_argument("--host", default=os.environ.get("WIREVIZ_GUI_HOST", "127.0.0.1"))
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("WIREVIZ_GUI_PORT", "8765")),
    )
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()

    uvicorn.run(
        "wireviz_gui_sidecar.app:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level="info",
    )


if __name__ == "__main__":
    main()
