"""IRS Tax Exempt Organization Search async wrapper."""
from __future__ import annotations

import asyncio
import re
import sys
from typing import Any

from . import propublica

IRS_BASE = "https://apps.irs.gov/app/eos/"


async def _fetch(url: str) -> Any:
    try:
        from scrapling.fetchers import StealthyFetcher  # type: ignore
    except Exception as exc:  # noqa: BLE001
        print(f"irs: scrapling import failed: {exc}", file=sys.stderr, flush=True)
        return None

    def _do_fetch():
        try:
            fetcher = StealthyFetcher()
            return fetcher.fetch(url, auto_match=True)
        except TypeError:
            try:
                fetcher = StealthyFetcher()
                return fetcher.fetch(url)
            except Exception as exc:  # noqa: BLE001
                print(f"irs: fetch error: {exc}", file=sys.stderr, flush=True)
                return None
        except Exception as exc:  # noqa: BLE001
            print(f"irs: fetch error: {exc}", file=sys.stderr, flush=True)
            return None

    return await asyncio.to_thread(_do_fetch)


async def search_by_ein(ein: str) -> dict[str, Any] | None:
    digits = re.sub(r"\D", "", str(ein))
    if len(digits) != 9:
        return None
    url = f"{IRS_BASE}?ein={digits}"
    page = await _fetch(url)
    if page is None:
        return None
    try:
        text = page.get_all_text() if hasattr(page, "get_all_text") else ""
    except Exception:
        text = ""
    if not text:
        return None
    return {
        "ein": digits,
        "name": "",
        "status": "",
        "ruling_date": "",
        "ntee_code": "",
        "classification": "",
    }


async def search_by_name(name: str) -> list[dict[str, Any]]:
    url = f"{IRS_BASE}?name={name}"
    page = await _fetch(url)
    if page is None:
        return []
    return []


async def enrich_from_propublica(record: dict[str, Any]) -> dict[str, Any]:
    ein = record.get("ein")
    if not ein:
        return record
    try:
        org = await propublica.get_organization(ein)
    except Exception as exc:  # noqa: BLE001
        print(f"irs: enrich failed: {exc}", file=sys.stderr, flush=True)
        return record
    organization = org.get("organization") or {}
    record.setdefault("name", organization.get("name") or "")
    record["classification"] = organization.get("classification") or record.get("classification", "")
    record["ntee_code"] = organization.get("ntee_code") or record.get("ntee_code", "")
    record["ruling_date"] = organization.get("ruling_date") or record.get("ruling_date", "")
    return record
