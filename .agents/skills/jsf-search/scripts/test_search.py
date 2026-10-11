from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from evaluate import ValidationError, canonical_url, criteria, evaluate, report
from linkedin import cards, details
from search import acquire, encoded


DESCRIPTION = ("Senior frontend engineer builds React and TypeScript. Next.js preferred. "
               "Fully remote from Poland. B2B 20000-28000 PLN/month before VAT. "
               "Own product. Warsaw office. No authorization restrictions.")


def obs(value, quote, field="description"):
    return {"value": value, "evidence": [{"field": field, "quote": quote}]}


def config():
    return {"sources": ["linkedin"], "titles": ["frontend engineer", "software engineer"],
            "target_count": 2, "candidate": {"country": "Poland", "city": "Warsaw"},
            "seniorities": ["middle", "senior"], "work_arrangements": ["remote", "hybrid"],
            "compensation": [{"contract": "b2b", "minimum": 25000, "currency": "PLN", "period": "month", "basis": "before_vat"}],
            "technical": {"required": ["react", "typescript"], "preferred": ["next.js"], "excluded": ["primarily java"]}}


def vacancy(job_id="1"):
    return {"source": "linkedin", "source_id": job_id, "url": f"https://www.linkedin.com/jobs/view/frontend-{job_id}?trk=search",
            "title": "Senior Frontend Engineer", "company": "Example", "location": "Poland",
            "posted_at": "2026-10-09", "description": DESCRIPTION, "fetch_status": "ok", "active": None,
            "facts": {
                "role_titles": obs(["frontend engineer"], "frontend engineer builds React and TypeScript"),
                "seniority": obs("senior", "Senior frontend engineer"),
                "work_arrangements": obs(["remote"], "Fully remote from Poland"),
                "eligible_countries": obs(["poland"], "Fully remote from Poland"),
                "vacancy_type": obs("product", "Own product"),
                "technical": {"react": obs(True, "builds React and TypeScript"),
                              "typescript": obs(True, "builds React and TypeScript"),
                              "next.js": obs(True, "Next.js preferred")},
                "compensation": [{"contract": "b2b", "currency": "PLN", "period": "month", "basis": "before_vat",
                                  "low": 20000, "high": 28000, "evidence": [{"field": "description", "quote": "B2B 20000-28000 PLN/month before VAT"}]}]}}


def snapshot(*vacancies):
    return {"schema_version": 1, "observed_at": "2026-10-10T12:00:00+00:00", "vacancies": list(vacancies)}


class EvaluationTests(unittest.TestCase):
    def test_replay_is_pure_and_deterministic(self):
        c, s = config(), snapshot(vacancy(), vacancy("2"))
        before = deepcopy((c, s))
        a, b = evaluate(c, s), evaluate(c, s)
        self.assertEqual(encoded(a), encoded(b))
        self.assertEqual((c, s), before)
        self.assertEqual(a["outcome"], "target_met")
        self.assertIn("lower end is below", report(a))

    def test_count_means_qualifying_openings(self):
        a, b, d = vacancy(), vacancy("2"), vacancy("3")
        b["facts"]["technical"].pop("react")
        d["facts"]["technical"]["react"] = obs(False, "builds React and TypeScript")
        r = evaluate(config(), snapshot(a, b, d))
        self.assertEqual((len(r["matches"]), len(r["needs_clarification"]), len(r["rejected"])), (1, 1, 1))
        self.assertEqual(r["coverage"]["shortfall"], 1)

    def test_empty_evidence_is_unknown_not_pass(self):
        v = vacancy()
        v["facts"]["technical"]["react"]["evidence"] = []
        self.assertEqual(evaluate(config(), snapshot(v))["needs_clarification"][0]["status"], "needs_clarification")

    def test_invented_evidence_is_rejected(self):
        v = vacancy()
        v["facts"]["technical"]["react"]["evidence"][0]["quote"] = "imaginary quotation"
        with self.assertRaisesRegex(ValidationError, "quote"):
            evaluate(config(), snapshot(v))

    def test_confirmed_exclusions_reject_and_missing_exclusion_does_not(self):
        v = vacancy()
        v["facts"]["technical"]["primarily java"] = obs(True, "builds React and TypeScript")
        self.assertEqual(len(evaluate(config(), snapshot(v))["rejected"]), 1)
        self.assertEqual(len(evaluate(config(), snapshot(vacancy()))["matches"]), 1)

    def test_closed_posting_rejects_but_unknown_activity_only_warns(self):
        v = vacancy()
        v["active"] = False
        self.assertEqual(len(evaluate(config(), snapshot(v))["rejected"]), 1)
        self.assertIn("Activity is unconfirmed", evaluate(config(), snapshot(vacancy()))["matches"][0]["warnings"])

    def test_country_restrictions_apply_to_remote_work(self):
        v = vacancy()
        v["facts"]["eligible_countries"]["value"] = ["germany"]
        self.assertEqual(len(evaluate(config(), snapshot(v))["rejected"]), 1)

    def test_hybrid_office_and_authorization(self):
        c, v = config(), vacancy()
        c["office_locations"] = ["warsaw, poland"]
        c["candidate"]["work_authorization"] = ["polish work permit"]
        v["facts"]["work_arrangements"]["value"] = ["hybrid"]
        v["facts"]["office_locations"] = obs(["warsaw, poland"], "Warsaw office")
        v["facts"]["authorization_requirements"] = obs([], "No authorization restrictions")
        self.assertEqual(len(evaluate(c, snapshot(v))["matches"]), 1)
        v["facts"]["office_locations"]["value"] = ["berlin, germany"]
        self.assertEqual(len(evaluate(c, snapshot(v))["rejected"]), 1)

    def test_no_restrictions_still_require_description_role_and_country_evidence(self):
        c = config()
        c.update(seniorities=None, compensation=None, work_arrangements=None,
                 technical={"required": [], "preferred": [], "excluded": []})
        self.assertEqual(len(evaluate(c, snapshot(vacancy()))["matches"]), 1)
        self.assertIn("Advertised: 20000–28000 PLN/month", report(evaluate(c, snapshot(vacancy()))))
        v = vacancy()
        v["description"] = None
        v["facts"] = {}
        self.assertEqual(len(evaluate(c, snapshot(v))["needs_clarification"]), 1)

    def test_compensation_missing_below_and_overlapping(self):
        v = vacancy()
        v["facts"]["compensation"] = []
        self.assertEqual(len(evaluate(config(), snapshot(v))["needs_clarification"]), 1)
        v = vacancy()
        v["facts"]["compensation"][0]["high"] = 24000
        self.assertEqual(len(evaluate(config(), snapshot(v))["rejected"]), 1)
        row = evaluate(config(), snapshot(vacancy()))["matches"][0]
        self.assertTrue(row["compensation_comparisons"][0]["lower_end_below_minimum"])

    def test_another_acceptable_contract_with_unknown_pay_prevents_false_rejection(self):
        c, v = config(), vacancy()
        c["compensation"].append({"contract": "uop", "minimum": 20000, "currency": "PLN", "period": "month", "basis": "gross"})
        v["facts"]["compensation"][0]["high"] = 24000
        self.assertEqual(len(evaluate(c, snapshot(v))["needs_clarification"]), 1)
        v["facts"]["contract_types"] = obs(["b2b"], "B2B 20000-28000 PLN/month before VAT")
        self.assertEqual(len(evaluate(c, snapshot(v))["rejected"]), 1)

    def test_fx_annual_and_hourly_conversion(self):
        c, v = config(), vacancy()
        band = v["facts"]["compensation"][0]
        band.update(currency="EUR", period="year", low=60000, high=84000)
        self.assertEqual(len(evaluate(c, snapshot(v))["needs_clarification"]), 1)
        c["conversions"] = {"fx": {"date": "2026-10-09", "source": "test fixture", "base": "EUR", "rates": {"EUR": 1, "PLN": 4}}}
        self.assertEqual(len(evaluate(c, snapshot(v))["matches"]), 1)
        band.update(currency="PLN", period="hour", low=150, high=180)
        self.assertEqual(len(evaluate(c, snapshot(v))["needs_clarification"]), 1)
        c["conversions"]["hours_per_month"] = 160
        self.assertEqual(len(evaluate(c, snapshot(v))["matches"]), 1)

    def test_same_currency_hourly_comparison_needs_no_hours(self):
        c, v = config(), vacancy()
        c["compensation"][0].update(minimum=150, period="hour")
        v["facts"]["compensation"][0].update(low=140, high=180, period="hour")
        self.assertEqual(len(evaluate(c, snapshot(v))["matches"]), 1)

    def test_preference_order_beats_recency_and_ties_are_stable(self):
        c, a, b = config(), vacancy("2"), vacancy("1")
        a["posted_at"] = "2026-10-01"
        b["facts"]["technical"].pop("next.js")
        self.assertEqual([r["vacancy_id"] for r in evaluate(c, snapshot(b, a))["matches"]], ["linkedin:2", "linkedin:1"])
        b = vacancy("1")
        b["posted_at"] = a["posted_at"]
        self.assertEqual([r["vacancy_id"] for r in evaluate(c, snapshot(a, b))["matches"]], ["linkedin:1", "linkedin:2"])

    def test_age_uses_fixed_snapshot_time(self):
        c, v = config(), vacancy()
        c["posting_age_days"] = 7
        v["posted_at"] = "2026-09-01"
        self.assertEqual(len(evaluate(c, snapshot(v))["rejected"]), 1)

    def test_source_id_dedup_and_cross_source_provenance(self):
        c, a, b = config(), vacancy(), vacancy()
        b["url"] = "https://pl.linkedin.com/jobs/view/another-slug-1?refId=abc"
        r = evaluate(c, snapshot(a, b))
        self.assertEqual((len(r["matches"]), r["coverage"]["duplicates_skipped"]), (1, 1))
        c["sources"].append("other")
        b.update(source="other", source_id="X", url="https://example.com/jobs/X")
        a["application_url"] = "https://ats.example/apply?jobId=123&utm_source=linkedin"
        b["application_url"] = "https://ats.example/apply?jobId=123"
        r = evaluate(c, snapshot(a, b))
        self.assertEqual(len(r["matches"]), 1)
        self.assertEqual(len(r["matches"][0]["provenance"]), 2)

    def test_distinct_requisitions_are_not_merged_by_tracking_normalization(self):
        a, b = vacancy(), vacancy("2")
        a["application_url"] = "https://ats.example/apply?jobId=123"
        b["application_url"] = "https://ats.example/apply?jobId=456"
        self.assertEqual(len(evaluate(config(), snapshot(a, b))["matches"]), 2)

    def test_conflicting_duplicate_evidence_requires_clarification(self):
        a, b = vacancy(), vacancy()
        b["facts"]["technical"]["react"]["value"] = False
        self.assertEqual(len(evaluate(config(), snapshot(a, b))["needs_clarification"]), 1)

    def test_changed_criteria_requires_explicit_reinterpretation(self):
        c, s = config(), snapshot(vacancy())
        s["interpreted_for"] = criteria(c)
        c["technical"]["required"].append("python")
        with self.assertRaisesRegex(ValidationError, "reinterpret"):
            evaluate(c, s)

    def test_input_validation_and_no_fixed_budget_ceiling(self):
        c = config()
        c["target_count"] = 100
        self.assertEqual(criteria(c)["discovery_budget"], 1000)
        for change in ({"target_count": True}, {"previous_results": []}, {"compensation": []}, {"discovery_budget": 1}):
            with self.subTest(change=change), self.assertRaises(ValidationError):
                criteria({**config(), **change})
        c = config()
        c["technical"]["excluded"].append("react")
        with self.assertRaises(ValidationError):
            criteria(c)


CARD_HTML = '''<li><div data-entity-urn="urn:li:jobPosting:123">
<a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/dev-123?trk=x"><span class="sr-only">Fallback</span></a>
<h3 class="base-search-card__title">Frontend &amp; UI Engineer</h3>
<h4 class="base-search-card__subtitle"><a>Example</a></h4>
<span class="job-search-card__location">Poland</span><time datetime="2026-10-09">Yesterday</time>
</div></li>'''
DETAIL_HTML = '''<h1 class="topcard__title">Frontend Engineer</h1>
<a class="topcard__org-name-link">Example</a><span class="topcard__flavor--bullet">Poland</span>
<div class="show-more-less-html__markup"><p>React <strong>required</strong>.</p><ul><li>TypeScript</li></ul><p>B2B rate.</p></div>
<li class="description__job-criteria-item"><h3 class="description__job-criteria-subheader">Seniority level</h3><span class="description__job-criteria-text">Mid-Senior level</span></li>
<a id="topbar-apply" href="https://ats.example/apply?jobId=123&amp;utm_source=linkedin">Apply</a>'''


class ParserTests(unittest.TestCase):
    def test_nested_html_details_and_stable_id(self):
        raw = cards(CARD_HTML)[0]
        self.assertEqual((raw["source_id"], raw["title"]), ("123", "Frontend & UI Engineer"))
        v = details(raw, DETAIL_HTML)
        self.assertIn("React required.\nTypeScript\nB2B rate.", v["description"])
        self.assertEqual(v["seniority_label"], "Mid-Senior level")
        self.assertIsNone(v["active"])
        self.assertEqual(v["application_url"], "https://ats.example/apply?jobId=123")
        self.assertFalse(details(raw, DETAIL_HTML + "No longer accepting applications")["active"])

    def test_bad_cards_are_not_reported_as_exhaustion(self):
        with self.assertRaises(ValidationError):
            cards('<div data-entity-urn="urn:li:jobPosting:123">Changed markup</div>')
        with self.assertRaises(ValidationError):
            cards('<html><h1>Unexpected sign-in page</h1></html>')
        self.assertEqual(cards(""), [])
        self.assertEqual(cards('<div>No matching jobs</div>'), [])

    def test_non_linkedin_urls_keep_identity_query_parameters(self):
        self.assertEqual(canonical_url("https://ats.example/apply?job=1&utm_source=x"), "https://ats.example/apply?job=1")


class FakeAdapter:
    page_size = 10
    calls = []

    def __init__(self, delay=0):
        pass

    def queries(self, c):
        return [{"title": title} for title in c["titles"]]

    def page(self, query, offset):
        self.calls.append((query["title"], offset))
        return [vacancy("1"), vacancy("2"), vacancy("3")] if offset == 0 else []

    def detail(self, candidate):
        return candidate


class AcquisitionTests(unittest.TestCase):
    def setUp(self):
        FakeAdapter.calls = []

    def test_checkpoint_preserves_pending_cards_and_stops_at_target(self):
        c = config()
        first = acquire(c, batch_size=1, delay=0, adapters={"linkedin": FakeAdapter})
        before = deepcopy(first)
        second = acquire(c, first, batch_size=1, delay=0, adapters={"linkedin": FakeAdapter})
        self.assertEqual(first, before)
        self.assertEqual([v["source_id"] for v in second["vacancies"]], ["1", "2"])
        self.assertGreater(second["coverage"]["duplicates_skipped"], 0)
        calls = deepcopy(FakeAdapter.calls)
        stopped = acquire(c, second, batch_size=1, delay=0, adapters={"linkedin": FakeAdapter})
        self.assertEqual(FakeAdapter.calls, calls)
        self.assertEqual(stopped["coverage"]["stopping_reason"], "target_met")

    def test_unknown_sources_fail_before_requests(self):
        c = config()
        c["sources"] = ["unknown"]
        with self.assertRaises(ValidationError):
            acquire(c, adapters={"linkedin": FakeAdapter})
        self.assertEqual(FakeAdapter.calls, [])

    def test_checkpoint_queries_are_validated_before_source_requests(self):
        c = config()
        s = acquire(c, batch_size=1, delay=0, adapters={"linkedin": FakeAdapter})
        s["acquisition"]["queries"][0]["query"] = {"unexpected": "query"}
        FakeAdapter.calls = []
        with self.assertRaises(ValidationError):
            acquire(c, s, adapters={"linkedin": FakeAdapter})
        self.assertEqual(FakeAdapter.calls, [])

    def test_raw_count_budget_and_repeated_page_failure(self):
        class UnknownFacts(FakeAdapter):
            def detail(self, candidate):
                return {**candidate, "facts": {}}
        c = config()
        c["discovery_budget"] = 2
        s = acquire(c, batch_size=10, delay=0, adapters={"linkedin": UnknownFacts})
        self.assertEqual(len(s["vacancies"]), 2)
        self.assertEqual(s["coverage"]["stopping_reason"], "discovery_budget")
        self.assertEqual(evaluate(c, s)["coverage"]["shortfall"], 2)
        class Repeated(FakeAdapter):
            def page(self, query, offset):
                return [vacancy()]
            def detail(self, candidate):
                return {**candidate, "facts": {}}
        s = acquire(config(), batch_size=10, delay=0, adapters={"linkedin": Repeated})
        self.assertEqual(s["coverage"]["stopping_reason"], "source_failure")
        self.assertIn("repeated", s["coverage"]["errors"][0])

    def test_failures_preserve_other_results(self):
        class PartlyBroken(FakeAdapter):
            def detail(self, candidate):
                if candidate["source_id"] == "2":
                    raise ValidationError("blocked")
                return candidate
        s = acquire(config(), batch_size=3, delay=0, adapters={"linkedin": PartlyBroken})
        r = evaluate(config(), s)
        self.assertEqual(len(r["matches"]), 2)
        self.assertEqual(len(r["needs_clarification"]), 1)
        self.assertIn("blocked", r["coverage"]["errors"][0])


class CLITests(unittest.TestCase):
    def test_validation_normalizes_without_network_or_snapshot(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "input.json"
            path.write_text(encoded(config()), encoding="utf-8")
            command = [sys.executable, str(Path(__file__).with_name("search.py")), "validate", "--criteria", str(path)]
            result = subprocess.run(command, capture_output=True, text=True, check=True)
            self.assertEqual(json.loads(result.stdout), criteria(config()))
            self.assertEqual(len(list(Path(temp).iterdir())), 1)

    def test_replay_stdout_and_explicit_artifacts(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "criteria.json").write_text(encoded(config()), encoding="utf-8")
            (root / "snapshot.json").write_text(encoded(snapshot(vacancy())), encoding="utf-8")
            command = [sys.executable, str(Path(__file__).with_name("search.py")), "evaluate", "--criteria", str(root / "criteria.json"), "--snapshot", str(root / "snapshot.json")]
            first = subprocess.run(command, capture_output=True, text=True, check=True)
            self.assertEqual(sorted(p.name for p in root.iterdir()), ["criteria.json", "snapshot.json"])
            output = root / "output"
            subprocess.run(command + ["--output-directory", str(output)], capture_output=True, check=True)
            self.assertEqual(json.loads(first.stdout), json.loads((output / "results.json").read_text()))
            self.assertEqual(sorted(p.name for p in output.iterdir()), ["criteria.json", "results.json", "shortlist.md", "snapshot.json"])
            before = {p.name: p.read_bytes() for p in output.iterdir()}
            subprocess.run(command + ["--output-directory", str(output)], capture_output=True, check=True)
            self.assertEqual(before, {p.name: p.read_bytes() for p in output.iterdir()})

    def test_invalid_inputs_do_not_create_output(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "bad.json").write_text('{}', encoding="utf-8")
            output = root / "output"
            result = subprocess.run([sys.executable, str(Path(__file__).with_name("search.py")), "acquire", "--criteria", str(root / "bad.json"), "--output-directory", str(output)], capture_output=True)
            self.assertEqual(result.returncode, 2)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
