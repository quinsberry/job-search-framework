"""National Bank of Poland (NBP) table A mid rates as dated search conversions, cached locally per table date."""

from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
import json
import os
from pathlib import Path
import tempfile
from urllib.request import Request, urlopen

from .evaluate import ValidationError


# The "current table" endpoint returns the last published table, so weekends and holidays never 404;
# only the /today/ and dated endpoints do.
URL = "https://api.nbp.pl/api/exchangerates/tables/a/"
MARKER = "nbp"  # conversions.fx value asking the caller to resolve current NBP rates at search start.
CURRENCIES = ("eur", "usd")


def warsaw_today():
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("Europe/Warsaw")).date()
    except Exception:  # No time zone database: UTC is at most a day off around midnight.
        return datetime.now(timezone.utc).date()


def fetch(timeout=10):
    request = Request(URL, headers={"Accept": "application/json", "User-Agent": "job-search-framework"})
    with urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8")


def table(text):
    """Validate one published table A response: its effective date, number and PLN mid rate per currency unit."""
    try:
        data = json.loads(text, parse_float=Decimal)
        entry = data[0] if isinstance(data, list) and len(data) == 1 else None
        effective = date.fromisoformat(entry["effectiveDate"]).isoformat()
        number = entry["no"]
        mids = {row["code"].lower(): Decimal(row["mid"]) for row in entry["rates"] if row["code"].lower() in CURRENCIES}
    except (ValueError, TypeError, KeyError, AttributeError, InvalidOperation):
        raise ValidationError("NBP returned an unexpected table A response") from None
    if not isinstance(number, str) or set(mids) != set(CURRENCIES) or any(mid <= 0 for mid in mids.values()):
        raise ValidationError("NBP table A lacks valid EUR and USD mid rates")
    return {"date": effective, "number": number, "mid": mids}


def conversion(parsed):
    """The search contract's FX object: base PLN, units of each currency per one PLN."""
    rates = {"pln": "1"}
    for code, mid in sorted(parsed["mid"].items()):
        rates[code] = str((Decimal(1) / mid).quantize(Decimal("1e-10")))
    return {"date": parsed["date"], "source": f"NBP table A {parsed['number']} ({URL})", "base": "pln", "rates": rates}


def newest_cached(directory):
    """The latest readable cached table. Published tables never change, so any cached date stays valid."""
    for path in sorted(Path(directory).glob("????-??-??.json"), reverse=True):
        try:
            parsed = table(json.loads(path.read_text())["response"])
        except (OSError, ValueError, KeyError, TypeError, ValidationError):
            continue
        if parsed["date"] == path.stem:
            return parsed
    return None


def store(directory, text, parsed, fetched_at):
    directory = Path(directory)
    path = directory / f"{parsed['date']}.json"
    if path.exists():
        return
    directory.mkdir(parents=True, exist_ok=True)
    handle, temp = tempfile.mkstemp(dir=directory, prefix=".nbp-", suffix=".json")
    try:
        with os.fdopen(handle, "w") as output:
            json.dump({"schema_version": 1, "url": URL, "fetched_at": fetched_at, "response": text}, output)
        os.replace(temp, path)
    except BaseException:
        Path(temp).unlink(missing_ok=True)
        raise


def resolve(directory, today=None, fetcher=fetch, now=None):
    """Current conversions: today's cached table without a request, else NBP's latest table, else the newest cached one.

    Status is fetched, cached (today's table), cached_fallback (NBP unreachable) or unavailable (no rates at all).
    """
    today = (today or warsaw_today()).isoformat()
    cached = newest_cached(directory)
    if cached and cached["date"] >= today:
        return outcome("cached", cached)
    try:
        text = fetcher()
        parsed = table(text)
    except (OSError, ValidationError) as exc:  # URLError and HTTPError are OSErrors.
        return outcome("cached_fallback", cached, str(exc)) if cached else {
            "schema_version": 1, "status": "unavailable", "fx": None, "error": str(exc)}
    try:
        store(directory, text, parsed, now or datetime.now(timezone.utc).isoformat())
    except OSError:
        pass  # The cache only saves requests; the fetched rates are still valid for this search.
    return outcome("fetched", parsed)


def outcome(status, parsed, error=None):
    result = {"schema_version": 1, "status": status, "fx": conversion(parsed), "table": parsed["number"], "date": parsed["date"]}
    if error:
        result["error"] = error
    return result
