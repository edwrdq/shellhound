"""Florida Sunbiz async scraping using Scrapling StealthyFetcher."""
from __future__ import annotations

import asyncio
import hashlib
import json
import sys
from pathlib import Path
from typing import Any
from urllib.parse import quote

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
ENTITIES_PATH = DATA_DIR / "entities.json"
RELATIONSHIPS_PATH = DATA_DIR / "relationships.json"

SUNBIZ_BASE = "https://search.sunbiz.org/Inquiry/CorporationSearch"


def _read_json_list(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        text = path.read_text(encoding="utf-8").strip()
        if not text:
            return []
        data = json.loads(text)
        return data if isinstance(data, list) else []
    except Exception as exc:  # noqa: BLE001
        print(f"sunbiz: cannot read {path}: {exc}", file=sys.stderr, flush=True)
        return []


def _write_json_list(path: Path, data: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _stable_id(*parts: str) -> str:
    raw = "|".join(p.strip().lower() for p in parts if p)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:24]


def _infer_type(name: str) -> str:
    upper = name.upper()
    if any(s in upper for s in (" LLC", "L.L.C.", " LLC.")):
        return "llc"
    if "FOUNDATION" in upper or "NONPROFIT" in upper or " ASSOC" in upper:
        return "nonprofit"
    if any(s in upper for s in (" INC", " CORP", "CORPORATION", "INCORPORATED")):
        return "corp"
    return "corp"


async def _fetch(url: str) -> Any:
    """Fetch a URL via Scrapling's StealthyFetcher in a thread."""
    try:
        from scrapling.fetchers import StealthyFetcher  # type: ignore
    except Exception as exc:  # noqa: BLE001
        print(f"sunbiz: scrapling import failed: {exc}", file=sys.stderr, flush=True)
        return None

    def _do_fetch():
        try:
            fetcher = StealthyFetcher()
            return fetcher.fetch(url)
        except Exception as exc:  # noqa: BLE001
            print(f"sunbiz: fetch error {url}: {exc}", file=sys.stderr, flush=True)
            return None

    return await asyncio.to_thread(_do_fetch)


def _parse_search_rows(page: Any) -> list[dict[str, Any]]:
    if page is None:
        return []
    rows: list[dict[str, Any]] = []
    try:
        # Scrapling adapters expose .css/.xpath; use css
        anchors = page.css("a[href*='SearchResultDetail']") or []
    except Exception:
        anchors = []

    for anchor in anchors:
        try:
            href = anchor.attrib.get("href") if hasattr(anchor, "attrib") else anchor.get("href", "")
            text = (anchor.text or "").strip() if hasattr(anchor, "text") else ""
            if not text:
                try:
                    text = anchor.get_all_text().strip()
                except Exception:
                    text = ""
            detail_url = href if href.startswith("http") else f"https://search.sunbiz.org{href}"
            rows.append(
                {
                    "name": text,
                    "document_number": _extract_qs(detail_url, "documentId") or "",
                    "status": "",
                    "detail_url": detail_url,
                }
            )
        except Exception as exc:  # noqa: BLE001
            print(f"sunbiz: row parse error: {exc}", file=sys.stderr, flush=True)
    return rows


def _extract_qs(url: str, key: str) -> str:
    from urllib.parse import urlparse, parse_qs

    try:
        qs = parse_qs(urlparse(url).query)
        values = qs.get(key) or []
        return values[0] if values else ""
    except Exception:
        return ""


async def search_by_name(name: str) -> list[dict[str, Any]]:
    encoded = quote(name)
    url = (
        f"{SUNBIZ_BASE}/SearchResults?InquiryType=EntityName"
        f"&inquiryDirectionType=ForwardList&searchNameOrder={encoded}"
    )
    page = await _fetch(url)
    await asyncio.sleep(1.5)
    return _parse_search_rows(page)


async def search_by_officer(name: str) -> list[dict[str, Any]]:
    encoded = quote(name)
    url = (
        f"{SUNBIZ_BASE}/SearchResults?InquiryType=OfficerRegisteredAgentName"
        f"&inquiryDirectionType=ForwardList&searchNameOrder={encoded}"
    )
    page = await _fetch(url)
    await asyncio.sleep(1.5)
    return _parse_search_rows(page)


async def get_entity_details(detail_url: str) -> dict[str, Any]:
    page = await _fetch(detail_url)
    await asyncio.sleep(1.5)
    if page is None:
        return {}

    def _text_or_none(selector: str) -> str:
        try:
            el = page.css_first(selector)
            if el is None:
                return ""
            txt = getattr(el, "text", None)
            return (txt or "").strip()
        except Exception:
            return ""

    name = _text_or_none(".corporationName") or _text_or_none("h1") or ""
    status = ""
    ein = ""
    try:
        # Most Sunbiz pages have label/value pairs in tables
        labels = page.css("label") or []
        for label in labels:
            text = (getattr(label, "text", "") or "").strip().lower()
            if "status" in text:
                # next sibling
                try:
                    sibling = label.next
                    if sibling is not None:
                        status = (getattr(sibling, "text", "") or "").strip()
                except Exception:
                    pass
    except Exception:
        pass

    officers: list[dict[str, str]] = []
    try:
        # Officers section often labelled
        officer_blocks = page.css(".officers, [id*='Officer']") or []
        for block in officer_blocks:
            text = ""
            try:
                text = block.get_all_text() if hasattr(block, "get_all_text") else (block.text or "")
            except Exception:
                text = ""
            if text:
                # Crude parse: name/title pairs separated by newlines
                for raw in text.split("\n"):
                    raw = raw.strip()
                    if not raw or len(raw) > 200:
                        continue
                    if any(t in raw.upper() for t in ("PRES", "DIRECTOR", "VP", "TREAS", "SECRET", "OFFICER", "MGR")):
                        officers.append({"name": raw, "title": ""})
    except Exception:
        pass

    registered_agent = None
    try:
        agent_blocks = page.css("[id*='Agent']") or []
        for block in agent_blocks:
            try:
                txt = block.get_all_text() if hasattr(block, "get_all_text") else (block.text or "")
                if txt and txt.strip():
                    registered_agent = {"name": txt.strip().split("\n")[0], "address": ""}
                    break
            except Exception:
                continue
    except Exception:
        pass

    return {
        "name": name,
        "type": _infer_type(name),
        "status": status or "active",
        "ein": ein or None,
        "state": "FL",
        "registered_agent": registered_agent,
        "officers": officers,
        "filing_history": [],
        "document_number": _extract_qs(detail_url, "documentId"),
        "sunbiz_url": detail_url,
    }


async def fetch_and_save_entities(
    query: str, search_type: str = "name"
) -> list[dict[str, Any]]:
    if search_type == "officer":
        results = await search_by_officer(query)
    else:
        results = await search_by_name(query)

    existing_entities = _read_json_list(ENTITIES_PATH)
    existing_relationships = _read_json_list(RELATIONSHIPS_PATH)

    by_id = {e.get("id"): e for e in existing_entities if e.get("id")}
    rel_keys = {
        f"{r.get('source_id')}:{r.get('target_id')}:{r.get('type')}:{r.get('year') or ''}": r
        for r in existing_relationships
    }

    saved: list[dict[str, Any]] = []
    for row in results:
        if not row.get("name"):
            continue
        try:
            details = await get_entity_details(row["detail_url"])
        except Exception as exc:  # noqa: BLE001
            print(f"sunbiz: detail fetch failed: {exc}", file=sys.stderr, flush=True)
            details = {}

        merged_name = details.get("name") or row["name"]
        document_number = details.get("document_number") or row.get("document_number") or ""
        entity_id = _stable_id(merged_name, document_number)
        agent_obj = details.get("registered_agent")
        agent_name = agent_obj.get("name") if isinstance(agent_obj, dict) else None

        entity = {
            "id": entity_id,
            "name": merged_name,
            "type": details.get("type") or _infer_type(merged_name),
            "ein": details.get("ein"),
            "state": "FL",
            "status": details.get("status") or "active",
            "registered_agent": agent_name,
            "officers": details.get("officers") or [],
            "sunbiz_url": details.get("sunbiz_url") or row.get("detail_url"),
            "metadata": {"document_number": document_number},
        }
        by_id[entity_id] = entity
        saved.append(entity)

        # Officer relationships
        for officer in entity["officers"]:
            officer_name = officer.get("name", "").strip()
            if not officer_name:
                continue
            officer_id = _stable_id(officer_name, "individual")
            if officer_id not in by_id:
                by_id[officer_id] = {
                    "id": officer_id,
                    "name": officer_name,
                    "type": "individual",
                    "ein": None,
                    "state": "FL",
                    "status": "active",
                    "registered_agent": None,
                    "officers": [],
                    "sunbiz_url": None,
                    "metadata": {},
                }
            rel = {
                "source_id": officer_id,
                "target_id": entity_id,
                "type": "officer",
                "amount": None,
                "description": officer.get("title") or "officer",
                "year": None,
            }
            rel_keys[f"{officer_id}:{entity_id}:officer:"] = rel

        # Registered agent relationship
        if agent_name:
            agent_id = _stable_id(agent_name, "individual")
            if agent_id not in by_id:
                by_id[agent_id] = {
                    "id": agent_id,
                    "name": agent_name,
                    "type": "individual",
                    "ein": None,
                    "state": "FL",
                    "status": "active",
                    "registered_agent": None,
                    "officers": [],
                    "sunbiz_url": None,
                    "metadata": {},
                }
            rel = {
                "source_id": agent_id,
                "target_id": entity_id,
                "type": "registered_agent",
                "amount": None,
                "description": "registered agent",
                "year": None,
            }
            rel_keys[f"{agent_id}:{entity_id}:registered_agent:"] = rel

    _write_json_list(ENTITIES_PATH, list(by_id.values()))
    _write_json_list(RELATIONSHIPS_PATH, list(rel_keys.values()))
    return saved
