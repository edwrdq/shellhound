"""Recursive discovery orchestrator for Shellhound scraper modules."""

from __future__ import annotations

import argparse
import json
import re
import sys
from hashlib import sha1
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scraper import irs, propublica, sunbiz  # noqa: E402


Entity = dict[str, Any]
Relationship = dict[str, Any]
Financial = dict[str, Any]


def _clean(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _person_id(name: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    digest = sha1(name.encode("utf-8")).hexdigest()[:8]
    return f"person-{normalized or 'unknown'}-{digest}"


def _person_entity(name: str) -> Entity:
    return {
        "id": _person_id(name),
        "name": name,
        "type": "individual",
        "ein": "",
        "state": "",
        "status": "Person",
        "registered_agent": "",
        "officers": [],
        "metadata": {"source": "crawler"},
    }


def _normalize_entity(entity: Entity) -> Entity:
    return {
        "id": str(entity.get("id") or _person_id(str(entity.get("name") or "unknown"))),
        "name": str(entity.get("name") or "Unknown"),
        "type": str(entity.get("type") or "llc").lower(),
        "ein": str(entity.get("ein") or ""),
        "state": str(entity.get("state") or ""),
        "status": str(entity.get("status") or ""),
        "registered_agent": str(entity.get("registered_agent") or ""),
        "officers": list(entity.get("officers") or []),
        "metadata": dict(entity.get("metadata") or {}),
    }


def _relationship(
    source_id: str,
    target_id: str,
    relationship_type: str,
    description: str,
    year: int | None = None,
) -> Relationship:
    return {
        "source_id": source_id,
        "target_id": target_id,
        "type": relationship_type,
        "amount": None,
        "description": description,
        "year": year,
    }


def _merge_entity(entities: dict[str, Entity], entity: Entity) -> Entity:
    normalized = _normalize_entity(entity)
    entities[normalized["id"]] = normalized
    return normalized


def _merge_relationship(relationships: dict[str, Relationship], relationship: Relationship) -> None:
    key = (
        f"{relationship['source_id']}:{relationship['target_id']}:"
        f"{relationship['type']}:{relationship.get('year') or ''}"
    )
    relationships[key] = relationship


def _collect_financials(entities: dict[str, Entity], errors: list[str]) -> list[Financial]:
    financials: dict[str, Financial] = {}

    for entity in entities.values():
        ein = _clean(entity.get("ein"))
        if not ein or entity.get("type") != "nonprofit":
            continue

        try:
            for financial in propublica.get_financials_by_ein(ein):
                financials[f"{financial['ein']}:{financial['year']}"] = financial
        except Exception as error:  # noqa: BLE001 - surfaced in UI JSON.
            errors.append(f"ProPublica {ein}: {error}")

    return list(financials.values())


def run_single(seed: str, scraper_type: str, limit: int) -> dict[str, Any]:
    errors: list[str] = []
    entities: list[Entity] = []
    financials: list[Financial] = []

    try:
        if scraper_type == "sunbiz":
            entities = [_normalize_entity(entity) for entity in sunbiz.search_entities(seed, limit)]
        elif scraper_type == "irs":
            entities = [_normalize_entity(entity) for entity in irs.search_tax_exempt(seed, limit)]
        elif scraper_type == "propublica":
            financials = propublica.get_financials_by_ein(seed)
        else:
            raise ValueError(f"Unsupported scraper type: {scraper_type}")
    except Exception as error:  # noqa: BLE001 - returned as structured JSON.
        errors.append(str(error))

    return {
        "seed": seed,
        "scraper_type": scraper_type,
        "entities": entities,
        "relationships": [],
        "financials": financials,
        "errors": errors,
    }


def crawl(seed: str, depth: int = 2, limit: int = 8) -> dict[str, Any]:
    entities: dict[str, Entity] = {}
    relationships: dict[str, Relationship] = {}
    errors: list[str] = []
    visited_terms: set[str] = set()
    queue: list[tuple[str, int]] = [(seed, 0)]

    while queue:
        term, level = queue.pop(0)
        normalized_term = term.lower()

        if normalized_term in visited_terms or level > depth:
            continue

        visited_terms.add(normalized_term)

        try:
            matches = sunbiz.search_entities(term, limit=limit)
        except Exception as error:  # noqa: BLE001 - returned as structured JSON.
            errors.append(f"Sunbiz entity search {term}: {error}")
            continue

        for raw_entity in matches:
            entity = _merge_entity(entities, raw_entity)

            for officer_name in entity["officers"][:limit]:
                officer_name = _clean(officer_name)
                if not officer_name:
                    continue

                person = _merge_entity(entities, _person_entity(officer_name))
                _merge_relationship(
                    relationships,
                    _relationship(
                        entity["id"],
                        person["id"],
                        "officer",
                        f"{officer_name} listed as officer or manager",
                    ),
                )

                if level + 1 > depth:
                    continue

                try:
                    related_entities = sunbiz.search_by_officer(officer_name, limit=limit)
                except Exception as error:  # noqa: BLE001 - returned as structured JSON.
                    errors.append(f"Sunbiz officer search {officer_name}: {error}")
                    continue

                for related_raw in related_entities:
                    related = _merge_entity(entities, related_raw)
                    _merge_relationship(
                        relationships,
                        _relationship(
                            person["id"],
                            related["id"],
                            "officer-affiliation",
                            f"{officer_name} appears on Sunbiz filing",
                        ),
                    )

                    if related["name"].lower() not in visited_terms:
                        queue.append((related["name"], level + 1))

    financials = _collect_financials(entities, errors)

    return {
        "seed": seed,
        "scraper_type": "crawler",
        "entities": list(entities.values()),
        "relationships": list(relationships.values()),
        "financials": financials,
        "errors": errors,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Shellhound scraper workflows")
    parser.add_argument("--seed", required=True, help="Organization name, officer name, or EIN")
    parser.add_argument(
        "--scraper-type",
        default="crawler",
        choices=("crawler", "sunbiz", "irs", "propublica"),
    )
    parser.add_argument("--depth", type=int, default=2)
    parser.add_argument("--limit", type=int, default=8)
    parser.add_argument("--json", action="store_true", help="Emit JSON only")
    args = parser.parse_args()

    if args.scraper_type == "crawler":
        result = crawl(args.seed, depth=args.depth, limit=args.limit)
    else:
        result = run_single(args.seed, args.scraper_type, args.limit)

    if args.json:
        print(json.dumps(result))
    else:
        print(json.dumps(result, indent=2))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
