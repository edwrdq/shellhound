"""Florida Sunbiz scraping helpers using Scrapling."""

from __future__ import annotations

import re
from hashlib import sha1
from typing import Any
from urllib.parse import quote_plus, urljoin

try:
    from scrapling.fetchers import Fetcher
except ImportError:  # pragma: no cover - keeps non-Sunbiz commands usable.
    Fetcher = None  # type: ignore[assignment]


SUNBIZ_BASE = "https://search.sunbiz.org"
ENTITY_SEARCH = f"{SUNBIZ_BASE}/Inquiry/CorporationSearch/SearchResults/EntityName"
OFFICER_SEARCH = (
    f"{SUNBIZ_BASE}/Inquiry/CorporationSearch/SearchResults/OfficerRegisteredAgentName"
)


def _require_fetcher() -> Any:
    if Fetcher is None:
        raise RuntimeError("scrapling is required for Sunbiz scraping")
    return Fetcher


def _fetch(url: str) -> Any:
    return _require_fetcher().fetch(
        url,
        timeout=30_000,
        extra_headers={
            "Accept-Language": "en-US,en;q=0.9",
        },
    )


def _clean(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _text_lines(page: Any) -> list[str]:
    return [_clean(line) for line in page.css("body ::text").getall() if _clean(line)]


def _line_after(lines: list[str], label: str) -> str:
    label_lower = label.lower()
    for index, line in enumerate(lines):
        if label_lower in line.lower() and index + 1 < len(lines):
            return lines[index + 1]
    return ""


def _stable_id(name: str, document_number: str = "") -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    digest = sha1(f"{name}:{document_number}".encode("utf-8")).hexdigest()[:8]
    return f"sunbiz-{normalized or 'entity'}-{digest}"


def _infer_type(name: str) -> str:
    upper_name = name.upper()
    if " LLC" in upper_name or upper_name.endswith("L.L.C."):
        return "llc"
    if " INC" in upper_name or "FOUNDATION" in upper_name or "MINISTR" in upper_name:
        return "nonprofit"
    return "llc"


def _parse_result_rows(page: Any, limit: int) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []

    for row in page.css("table tr"):
        href = row.css("a::attr(href)").get("")
        name = _clean(row.css("a::text").get(""))
        cells = [_clean(text) for text in row.css("td ::text").getall() if _clean(text)]

        if not href or not name:
            continue

        rows.append(
            {
                "name": name,
                "url": urljoin(SUNBIZ_BASE, href),
                "document_number": cells[0] if cells else "",
            }
        )

        if len(rows) >= limit:
            break

    return rows


def _parse_entity_detail(url: str, fallback_name: str, document_number: str = "") -> dict[str, Any]:
    page = _fetch(url)
    lines = _text_lines(page)
    body = "\n".join(lines)
    name = _clean(page.css("h1::text").get("")) or fallback_name
    ein_match = re.search(r"\b\d{2}-?\d{7}\b", body)

    officers = []
    for label in ("Authorized Person", "Officer/Director", "Manager", "Title"):
        value = _line_after(lines, label)
        if value and value not in officers and len(value) < 120:
            officers.append(value)

    return {
        "id": _stable_id(name, document_number),
        "name": name,
        "type": _infer_type(name),
        "ein": ein_match.group(0).replace("-", "") if ein_match else "",
        "state": "FL",
        "status": _line_after(lines, "Status") or "Unknown",
        "registered_agent": _line_after(lines, "Registered Agent Name") or "",
        "officers": officers,
        "metadata": {
            "document_number": document_number,
            "source": "sunbiz",
            "source_url": url,
        },
    }


def search_entities(query: str, limit: int = 10) -> list[dict[str, Any]]:
    """Search Florida Sunbiz by entity name and return normalized entity records."""

    url = f"{ENTITY_SEARCH}/{quote_plus(query)}/Page1"
    page = _fetch(url)
    rows = _parse_result_rows(page, limit)
    return [
        _parse_entity_detail(row["url"], row["name"], row["document_number"])
        for row in rows
    ]


def search_by_officer(name: str, limit: int = 10) -> list[dict[str, Any]]:
    """Search Florida Sunbiz by officer or registered agent name."""

    url = f"{OFFICER_SEARCH}/{quote_plus(name)}/Page1"
    page = _fetch(url)
    rows = _parse_result_rows(page, limit)
    return [
        _parse_entity_detail(row["url"], row["name"], row["document_number"])
        for row in rows
    ]
