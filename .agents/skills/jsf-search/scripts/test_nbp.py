from datetime import date
from decimal import Decimal
import json
from pathlib import Path
import tempfile
import unittest
from urllib.error import HTTPError, URLError

from jsf_search import evaluate, nbp
from jsf_search.evaluate import ValidationError
from test_search import config, snapshot, vacancy


def response(day="2026-10-21", number="205/A/NBP/2026", usd=3.8889, eur=4.3641):
    """Shape of a live https://api.nbp.pl/api/exchangerates/tables/a/ response, trimmed to three currencies."""
    return json.dumps([{"table": "A", "no": number, "effectiveDate": day, "rates": [
        {"currency": "bat (Tajlandia)", "code": "THB", "mid": 0.1156},
        {"currency": "dolar amerykański", "code": "USD", "mid": usd},
        {"currency": "euro", "code": "EUR", "mid": eur}]}], ensure_ascii=False)


class Fetcher:
    def __init__(self, *results):
        self.results, self.calls = list(results), 0

    def __call__(self):
        self.calls += 1
        result = self.results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


class NBPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.cache = Path(self.temp.name) / "fx" / "nbp-a"

    def tearDown(self):
        self.temp.cleanup()

    def test_table_becomes_dated_pln_based_conversions(self):
        parsed = nbp.table(response())
        self.assertEqual((parsed["date"], parsed["number"]), ("2026-10-21", "205/A/NBP/2026"))
        self.assertEqual(parsed["mid"], {"usd": Decimal("3.8889"), "eur": Decimal("4.3641")})
        fx = nbp.conversion(parsed)
        self.assertEqual((fx["date"], fx["base"], fx["rates"]["pln"]), ("2026-10-21", "pln", "1"))
        self.assertEqual(fx["rates"]["usd"], "0.2571421225")
        self.assertIn("205/A/NBP/2026", fx["source"])
        self.assertEqual(evaluate.criteria({**config(), "conversions": {"fx": fx}})["conversions"]["fx"]["base"], "pln")
        for bad in ("not json", "[]", json.dumps([{"no": "1", "effectiveDate": "2026-10-21", "rates": []}]),
                    response(usd=0), response(day="21.10.2026")):
            with self.assertRaises(ValidationError):
                nbp.table(bad)

    def test_nbp_rates_compare_pln_pay_with_a_usd_minimum(self):
        def status(minimum, fx):
            c = config()
            c["compensation"] = [{"contract": "b2b", "minimum": minimum, "currency": "USD", "period": "month", "basis": "before_vat"}]
            c["conversions"] = {"fx": fx}
            checks = evaluate.evaluate(c, snapshot(vacancy()))["assessments"][0]["checks"]
            return next(check["status"] for check in checks if check["criterion"] == "compensation")
        fx = nbp.conversion(nbp.table(response()))
        self.assertEqual(status(7000, fx), "pass")  # 28000 PLN / 3.8889 ≈ 7200 USD.
        self.assertEqual(status(7500, fx), "fail")
        self.assertEqual(status(7000, "NBP"), "unknown")  # Unresolved marker: no rates, no guessing.

    def test_today_uses_cache_and_other_days_ask_nbp_for_its_latest_table(self):
        first = nbp.resolve(self.cache, today=date(2026, 10, 21), fetcher=Fetcher(response()), now="2026-10-21T13:00:00+00:00")
        self.assertEqual((first["status"], first["table"]), ("fetched", "205/A/NBP/2026"))
        saved = json.loads((self.cache / "2026-10-21.json").read_text())
        self.assertEqual((saved["fetched_at"], json.loads(saved["response"])[0]["no"]), ("2026-10-21T13:00:00+00:00", "205/A/NBP/2026"))
        unused = Fetcher(AssertionError("today's table is cached"))
        self.assertEqual(nbp.resolve(self.cache, today=date(2026, 10, 21), fetcher=unused)["status"], "cached")
        self.assertEqual(unused.calls, 0)
        # Saturday: the latest table is still Friday's; NBP's current-table endpoint returns it instead of 404.
        friday = response("2026-10-23", "207/A/NBP/2026", usd=3.9)
        weekend = nbp.resolve(self.cache, today=date(2026, 10, 24), fetcher=Fetcher(friday))
        self.assertEqual((weekend["status"], weekend["date"], weekend["fx"]["date"]), ("fetched", "2026-10-23", "2026-10-23"))
        self.assertTrue((self.cache / "2026-10-23.json").exists())

    def test_unreachable_nbp_falls_back_to_the_newest_cached_table(self):
        nbp.resolve(self.cache, today=date(2026, 10, 20), fetcher=Fetcher(response("2026-10-20", "204/A/NBP/2026")))
        nbp.resolve(self.cache, today=date(2026, 10, 21), fetcher=Fetcher(response()))
        (self.cache / "2026-10-22.json").write_text("corrupt")
        for failure in (URLError("offline"), HTTPError(nbp.URL, 503, "Service Unavailable", {}, None), response(usd=-1)):
            fallback = nbp.resolve(self.cache, today=date(2026, 10, 23), fetcher=Fetcher(failure))
            self.assertEqual((fallback["status"], fallback["table"]), ("cached_fallback", "205/A/NBP/2026"))
            self.assertTrue(fallback["error"])
        empty = Path(self.temp.name) / "empty"
        missing = nbp.resolve(empty, today=date(2026, 10, 23), fetcher=Fetcher(URLError("offline")))
        self.assertEqual((missing["status"], missing["fx"]), ("unavailable", None))
        self.assertFalse(empty.exists())


if __name__ == "__main__":
    unittest.main()
