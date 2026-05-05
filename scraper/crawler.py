"""Recursive discovery orchestrator for Shellhound."""
from __future__ import annotations

import hashlib
import json
import re
import sys
import uuid
from pathlib import Path
from typing import Any

from . import irs, propublica, sunbiz

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
ENTITIES_PATH = DATA_DIR / "entities.json"
RELATIONSHIPS_PATH = DATA_DIR / "relationships.json"
FINANCIALS_PATH = DATA_DIR / "financials.json"


def _progress(message: str) -> None:
    payload = json.dumps({"event": "progress", "message": message})
    print(payload, flush=True)
    print(message, flush=True)


def _read_list(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        text = path.read_text(encoding="utf-8").strip()
        if not text:
            return []
        data = json.loads(text)
        return data if isinstance(data, list) else []
    except Exception as exc:  # noqa: BLE001
        print(f"crawler: read {path} error: {exc}", file=sys.stderr, flush=True)
        return []


def _write_list(path: Path, data: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _norm_name(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").strip().lower())


def _stable_id(*parts: str) -> str:
    raw = "|".join(p.strip().lower() for p in parts if p)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:24]


def _visit_key(name: str, ein: str | None) -> str:
    return f"{_norm_name(name)}|{ein or ''}"


class CrawlState:
    def __init__(self) -> None:
        self.entities: dict[str, dict[str, Any]] = {
            e["id"]: e for e in _read_list(ENTITIES_PATH) if e.get("id")
        }
        self.relationships: dict[str, dict[str, Any]] = {}
        for rel in _read_list(RELATIONSHIPS_PATH):
            self.relationships[self._rel_key(rel)] = rel
        self.financials: dict[str, dict[str, Any]] = {}
        for fin in _read_list(FINANCIALS_PATH):
            key = f"{fin.get('ein')}:{fin.get('year')}"
            self.financials[key] = fin
        self.errors: list[str] = []
        self.visited: set[str] = set()

    @staticmethod
    def _rel_key(rel: dict[str, Any]) -> str:
        return (
            f"{rel.get('source_id')}:{rel.get('target_id')}:"
            f"{rel.get('type')}:{rel.get('year') or ''}"
        )

    def add_entity(self, entity: dict[str, Any]) -> str:
        eid = entity.get("id") or uuid.uuid4().hex
        entity["id"] = eid
        self.entities[eid] = entity
        return eid

    def add_relationship(self, rel: dict[str, Any]) -> None:
        self.relationships[self._rel_key(rel)] = rel

    def add_financial(self, fin: dict[str, Any]) -> None:
        key = f"{fin.get('ein')}:{fin.get('year')}"
        self.financials[key] = fin

    def flush(self) -> None:
        _write_list(ENTITIES_PATH, list(self.entities.values()))
        _write_list(RELATIONSHIPS_PATH, list(self.relationships.values()))
        _write_list(FINANCIALS_PATH, list(self.financials.values()))


def _ensure_individual(state: CrawlState, name: str) -> str:
    eid = _stable_id(name, "individual")
    if eid not in state.entities:
        state.entities[eid] = {
            "id": eid,
            "name": name,
            "type": "individual",
            "ein": None,
            "state": "FL",
            "status": "active",
            "registered_agent": None,
            "officers": [],
            "sunbiz_url": None,
            "metadata": {},
        }
    return eid


async def _process_propublica(
    state: CrawlState, ein: str, entity_id: str | None = None
) -> dict[str, Any] | None:
    try:
        org = await propublica.get_organization(ein)
    except Exception as exc:  # noqa: BLE001
        state.errors.append(f"propublica/{ein}: {exc}")
        _progress(f"ProPublica miss for {ein}: {exc}")
        return None
    organization = org.get("organization") or {}
    name = organization.get("name") or ""
    eid = entity_id or _stable_id(name, ein)
    entity = state.entities.get(eid, {})
    entity.update(
        {
            "id": eid,
            "name": name or entity.get("name") or ein,
            "type": "nonprofit",
            "ein": re.sub(r"\D", "", ein),
            "state": organization.get("state") or entity.get("state") or "FL",
            "status": "active",
            "registered_agent": entity.get("registered_agent"),
            "officers": entity.get("officers") or [],
            "sunbiz_url": entity.get("sunbiz_url"),
            "metadata": {
                **(entity.get("metadata") or {}),
                "ntee_code": organization.get("ntee_code"),
                "classification": organization.get("classification"),
                "ruling_date": organization.get("ruling_date"),
            },
        }
    )
    state.entities[eid] = entity

    filings = org.get("filings_with_data") or []
    for filing in filings:
        try:
            record = propublica.extract_financials(filing, ein)
        except Exception as exc:  # noqa: BLE001
            state.errors.append(f"financials/{ein}: {exc}")
            continue
        record["entity_id"] = eid
        state.add_financial(record)

        for executive in record.get("executives") or []:
            ex_name = (executive.get("name") or "").strip()
            if not ex_name:
                continue
            indiv_id = _ensure_individual(state, ex_name)
            state.add_relationship(
                {
                    "source_id": indiv_id,
                    "target_id": eid,
                    "type": "officer",
                    "amount": executive.get("compensation") or None,
                    "description": executive.get("title") or "officer",
                    "year": record.get("year") or None,
                }
            )

    return entity


async def _process_sunbiz_search(
    state: CrawlState, query: str, search_type: str
) -> list[dict[str, Any]]:
    if search_type == "officer":
        rows = await sunbiz.search_by_officer(query)
    else:
        rows = await sunbiz.search_by_name(query)

    found: list[dict[str, Any]] = []
    for row in rows:
        if not row.get("name") or not row.get("detail_url"):
            continue
        try:
            details = await sunbiz.get_entity_details(row["detail_url"])
        except Exception as exc:  # noqa: BLE001
            state.errors.append(f"sunbiz/{row['name']}: {exc}")
            continue
        merged_name = details.get("name") or row["name"]
        document_number = details.get("document_number") or row.get("document_number") or ""
        eid = _stable_id(merged_name, document_number)
        agent_obj = details.get("registered_agent")
        agent_name = agent_obj.get("name") if isinstance(agent_obj, dict) else None
        entity = {
            "id": eid,
            "name": merged_name,
            "type": details.get("type") or "corp",
            "ein": details.get("ein"),
            "state": "FL",
            "status": details.get("status") or "active",
            "registered_agent": agent_name,
            "officers": details.get("officers") or [],
            "sunbiz_url": details.get("sunbiz_url") or row.get("detail_url"),
            "metadata": {"document_number": document_number},
        }
        state.entities[eid] = entity

        for officer in entity["officers"]:
            officer_name = (officer.get("name") or "").strip()
            if not officer_name:
                continue
            indiv_id = _ensure_individual(state, officer_name)
            state.add_relationship(
                {
                    "source_id": indiv_id,
                    "target_id": eid,
                    "type": "officer",
                    "amount": None,
                    "description": officer.get("title") or "officer",
                    "year": None,
                }
            )

        if agent_name:
            agent_id = _ensure_individual(state, agent_name)
            state.add_relationship(
                {
                    "source_id": agent_id,
                    "target_id": eid,
                    "type": "registered_agent",
                    "amount": None,
                    "description": "registered agent",
                    "year": None,
                }
            )

        found.append(entity)
    return found


async def crawl(
    seed: str, seed_type: str = "ein", depth: int = 2
) -> dict[str, Any]:
    state = CrawlState()

    async def visit(name: str | None, ein: str | None, current_depth: int) -> None:
        if current_depth > depth:
            return
        key = _visit_key(name or "", ein)
        if key in state.visited:
            return
        state.visited.add(key)

        # ProPublica + IRS for EIN
        if ein:
            _progress(f"ProPublica lookup for EIN {ein} (depth {current_depth})")
            entity = await _process_propublica(state, ein)
            if entity and not name:
                name = entity.get("name")
            try:
                await irs.search_by_ein(ein)
            except Exception as exc:  # noqa: BLE001
                state.errors.append(f"irs/{ein}: {exc}")

        # Sunbiz search by name
        if name:
            _progress(f"Sunbiz search for '{name}' (depth {current_depth})")
            entities = await _process_sunbiz_search(state, name, "name")
            state.flush()

            if current_depth + 1 <= depth:
                for ent in entities:
                    # Recurse on officers / agent
                    for officer in ent.get("officers") or []:
                        oname = (officer.get("name") or "").strip()
                        if oname:
                            _progress(
                                f"Recursing officer search: {oname} (depth {current_depth + 1})"
                            )
                            await _process_sunbiz_search(state, oname, "officer")
                            state.flush()
                    if ent.get("registered_agent"):
                        await _process_sunbiz_search(
                            state, ent["registered_agent"], "officer"
                        )
                        state.flush()
                    # If nonprofit and has EIN, hit ProPublica
                    if ent.get("type") == "nonprofit" and ent.get("ein"):
                        await _process_propublica(state, ent["ein"], ent["id"])
                        state.flush()
        state.flush()

    if seed_type == "ein":
        await visit(None, seed, 1)
    else:
        await visit(seed, None, 1)

    state.flush()

    return {
        "entities": list(state.entities.values()),
        "relationships": list(state.relationships.values()),
        "financials": list(state.financials.values()),
        "errors": state.errors,
    }
