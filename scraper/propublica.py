"""ProPublica Nonprofit Explorer async client."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

import httpx

USER_AGENT = "Shellhound/0.1 (investigative tooling)"
BASE_URL = "https://projects.propublica.org/nonprofits/api/v2"

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
FINANCIALS_PATH = DATA_DIR / "financials.json"


def _normalize_ein(ein: str) -> str:
    digits = re.sub(r"\D", "", str(ein))
    if len(digits) != 9:
        raise ValueError(f"Invalid EIN: {ein!r} (need 9 digits, got {len(digits)})")
    return digits


async def get_organization(ein: str) -> dict[str, Any]:
    digits = _normalize_ein(ein)
    url = f"{BASE_URL}/organizations/{digits}.json"
    async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}, timeout=30) as client:
        try:
            response = await client.get(url)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                raise ValueError(f"ProPublica: EIN {digits} not found") from exc
            if exc.response.status_code == 429:
                raise RuntimeError("ProPublica rate limit hit (429)") from exc
            raise RuntimeError(
                f"ProPublica HTTP {exc.response.status_code} for EIN {digits}"
            ) from exc
        return response.json()


async def get_filings(ein: str) -> list[dict[str, Any]]:
    try:
        payload = await get_organization(ein)
    except Exception as exc:  # noqa: BLE001
        print(f"propublica: get_filings error: {exc}", file=sys.stderr, flush=True)
        return []
    return payload.get("filings_with_data") or []


def _coerce_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def extract_financials(filing: dict[str, Any], ein: str) -> dict[str, Any]:
    digits = _normalize_ein(ein)
    year = filing.get("tax_prd_yr") or filing.get("tax_year") or filing.get("tax_prd")
    try:
        year_int = int(year) if year is not None else 0
    except (TypeError, ValueError):
        year_int = 0

    program_expenses = filing.get("totprgmrevnue")
    if program_expenses is None:
        program_expenses = filing.get("totprogrevnue")

    raw_officers = filing.get("officers") or []
    executives = []
    for officer in raw_officers:
        if not isinstance(officer, dict):
            continue
        executives.append(
            {
                "name": officer.get("name") or officer.get("officer_name") or "",
                "title": officer.get("title") or officer.get("titletxt") or "",
                "compensation": _coerce_int(
                    officer.get("compensation")
                    or officer.get("totcomp")
                    or officer.get("reportable_compensation")
                ),
            }
        )

    return {
        "ein": digits,
        "year": year_int,
        "total_revenue": _coerce_int(filing.get("totrevenue")),
        "total_expenses": _coerce_int(filing.get("totfuncexpns")),
        "total_salaries": _coerce_int(filing.get("compnsatncurrofcr")),
        "program_expenses": _coerce_int(program_expenses),
        "executives": executives,
        "related_party_transactions": [],
        "source": "propublica",
    }


def _read_json_list(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        contents = path.read_text(encoding="utf-8").strip()
        if not contents:
            return []
        data = json.loads(contents)
        return data if isinstance(data, list) else []
    except Exception as exc:  # noqa: BLE001
        print(f"propublica: cannot read {path}: {exc}", file=sys.stderr, flush=True)
        return []


def _write_json_list(path: Path, data: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


async def fetch_and_save_financials(
    ein: str, entity_id: str | None = None
) -> list[dict[str, Any]]:
    digits = _normalize_ein(ein)
    filings = await get_filings(digits)
    if not filings:
        return []

    extracted: list[dict[str, Any]] = []
    for filing in filings:
        try:
            record = extract_financials(filing, digits)
        except Exception as exc:  # noqa: BLE001
            print(f"propublica: extract failed: {exc}", file=sys.stderr, flush=True)
            continue
        if entity_id:
            record["entity_id"] = entity_id
        extracted.append(record)

    existing = _read_json_list(FINANCIALS_PATH)
    by_key: dict[str, dict[str, Any]] = {
        f"{rec.get('ein')}:{rec.get('year')}": rec for rec in existing
    }
    for record in extracted:
        by_key[f"{record['ein']}:{record['year']}"] = record

    _write_json_list(FINANCIALS_PATH, list(by_key.values()))
    return extracted
