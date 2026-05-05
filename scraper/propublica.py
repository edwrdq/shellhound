"""ProPublica Nonprofit Explorer API client."""

from __future__ import annotations

import json
import re
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen


API_ROOT = "https://projects.propublica.org/nonprofits/api/v2/organizations"


def _clean_ein(ein: str) -> str:
    digits = re.sub(r"\D+", "", ein)
    if len(digits) != 9:
        raise ValueError("EIN must contain 9 digits")
    return digits


def _number(value: Any) -> int:
    try:
        return int(float(value or 0))
    except (TypeError, ValueError):
        return 0


def _get_first(mapping: dict[str, Any], keys: tuple[str, ...]) -> Any:
    for key in keys:
        if key in mapping and mapping[key] is not None:
            return mapping[key]
    return 0


def _executives(filing: dict[str, Any]) -> list[dict[str, Any]]:
    officers = filing.get("officers") or filing.get("key_employees") or []
    executives = []

    for officer in officers:
        if not isinstance(officer, dict):
            continue

        executives.append(
            {
                "name": officer.get("name") or officer.get("person_name") or "",
                "title": officer.get("title") or officer.get("position") or "",
                "compensation": _number(
                    officer.get("compensation")
                    or officer.get("compensation_amount")
                    or officer.get("reportable_comp_from_org")
                ),
            }
        )

    return executives


def _financial_from_filing(ein: str, filing: dict[str, Any]) -> dict[str, Any]:
    return {
        "ein": ein,
        "year": _number(
            _get_first(filing, ("tax_prd_yr", "tax_year", "year", "tax_period_year"))
        ),
        "total_revenue": _number(
            _get_first(filing, ("totrevenue", "total_revenue", "totrevenueamt"))
        ),
        "total_expenses": _number(
            _get_first(filing, ("totfuncexpns", "total_expenses", "totexpns"))
        ),
        "salaries": _number(
            _get_first(
                filing,
                (
                    "compnsatncurrofcr",
                    "compensation_current_officers",
                    "salaries_compensation",
                ),
            )
        ),
        "related_party_transactions": filing.get("related_party_transactions") or [],
        "executives": _executives(filing),
    }


def get_organization(ein: str) -> dict[str, Any]:
    """Fetch one organization record from ProPublica by EIN."""

    clean_ein = _clean_ein(ein)
    request = Request(
        f"{API_ROOT}/{clean_ein}.json",
        headers={"User-Agent": "Shellhound/0.1"},
    )

    try:
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        if error.code == 404:
            return {"organization": None, "filings_with_data": []}
        raise


def get_financials_by_ein(ein: str) -> list[dict[str, Any]]:
    """Return normalized 990 financial data for one EIN."""

    clean_ein = _clean_ein(ein)
    payload = get_organization(clean_ein)
    filings = payload.get("filings_with_data") or payload.get("filings") or []
    return [_financial_from_filing(clean_ein, filing) for filing in filings]
