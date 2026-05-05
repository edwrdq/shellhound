"""Shellhound scraper CLI entry point."""
from __future__ import annotations

import argparse
import asyncio
import json
import sys

# Make stdout line-buffered for live streaming.
try:
    sys.stdout.reconfigure(line_buffering=True)  # type: ignore[attr-defined]
except Exception:
    pass

# Allow `python main.py` from inside the scraper directory by ensuring the
# parent of this file is on sys.path so `from scraper import crawler` works.
import os
_HERE = os.path.dirname(os.path.abspath(__file__))
_PARENT = os.path.dirname(_HERE)
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)

from scraper import crawler  # noqa: E402


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="shellhound-scraper")
    parser.add_argument("--seed", required=True)
    parser.add_argument("--type", dest="seed_type", default="ein", choices=["ein", "name"])
    parser.add_argument("--depth", type=int, default=2)
    return parser


async def _main_async(args: argparse.Namespace) -> int:
    try:
        result = await crawler.crawl(
            seed=args.seed, seed_type=args.seed_type, depth=args.depth
        )
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"event": "error", "message": str(exc)}), flush=True)
        return 1

    summary = {
        "event": "complete",
        "entities": len(result.get("entities") or []),
        "relationships": len(result.get("relationships") or []),
        "financials": len(result.get("financials") or []),
        "errors": result.get("errors") or [],
    }
    print(json.dumps(summary), flush=True)
    return 0


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()
    try:
        return asyncio.run(_main_async(args))
    except KeyboardInterrupt:
        print(json.dumps({"event": "error", "message": "interrupted"}), flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
