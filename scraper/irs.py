"""IRS Tax Exempt Organization Search helpers using Scrapling."""

from __future__ import annotations

import re
from hashlib import sha1
from typing import Any
from urllib.parse import quote_plus

try:
    from scrapling.fetchers import DynamicFetcher, Fetcher
except ImportError:  # pragma: no cover - keeps non-IRS commands usable.
    DynamicFetcher = None  # type: ignore[assignment]
    Fetcher = None  # type: ignore[assignment]


IRS_SEARCH = "https://apps.irs.gov/app/eos/"


def _require_fetcher() -> Any:
    if DynamicFetcher is not None:
        return DynamicFetcher
    if Fetcher is not None:
        return Fetcher
    raise RuntimeError("scrapling is required for IRS scraping")


def _clean(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _stable_id(name: str, ein: str = "") -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    digest = sha1(f"{name}:{ein}".encode("utf-8")).hexdigest()[:8]
    return f"irs-{normalized or 'organization'}-{digest}"


def _fetch_search(query: str) -> Any:
    search_url = f"{IRS_SEARCH}?searchChoice=pub78&searchText={quote_plus(query)}"
    fetcher = _require_fetcher()
    kwargs = {"timeout": 30_000}
    if fetcher is DynamicFetcher:
        kwargs.update({"wait": 1_000, "wait_selector": "body"})
    return fetcher.fetch(search_url, **kwargs)


def _parse_rows(page: Any, limit: int) -> list[dict[str, Any]]:
    entities: list[dict[str, Any]] = []

    for row in page.css("table tr"):
        cells = [_clean(text) for text in row.css("td ::text").getall() if _clean(text)]
        if len(cells) < 2:
            continue

        joined = " ".join(cells)
        ein_match = re.search(r"\b\d{2}-?\d{7}\b", joined)
        name = cells[0]
        ein = ein_match.group(0).replace("-", "") if ein_match else ""

        entities.append(
            {
                "id": _stable_id(name, ein),
                "name": name,
                "type": "nonprofit",
                "ein": ein,
                "state": next((cell for cell in cells if re.fullmatch(r"[A-Z]{2}", cell)), ""),
                "status": "Tax exempt",
                "registered_agent": "",
                "officers": [],
                "metadata": {
                    "raw_cells": cells,
                    "source": "irs",
                    "source_url": getattr(page, "url", IRS_SEARCH),
                },
            }
        )

        if len(entities) >= limit:
            break

    return entities


def search_tax_exempt(query: str, limit: int = 10) -> list[dict[str, Any]]:
    """Search IRS Tax Exempt Organization Search by EIN or organization name."""

    page = _fetch_search(query)
    return _parse_rows(page, limit)
