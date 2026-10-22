# Fetch exchange rates from the National Bank of Poland

Status: resolved

## Request

Manual `conversions.fx` rates go stale and must be looked up by hand. Fetch current rates from the official NBP API when a search starts, cache responses per date locally, and avoid the API's errors on days without a published table.

## External documentation checked

- https://api.nbp.pl/en.html — `exchangerates/tables/{table}/` returns the last published table; `/today/` and dated queries return 404 when no table exists for that day; JSON by default; HTTPS required from 1 August 2025; no documented request limit. Publication times are not documented.
- Live checks on 2026-10-21: `tables/a/` → 200, table `205/A/NBP/2026`, `effectiveDate` 2026-10-21; `rates/a/usd/2026-10-17/` and `2026-10-18/` (Saturday, Sunday) → `404 NotFound - Not Found - Brak danych`. Response fields: `table`, `no`, `effectiveDate`, `rates[] {currency, code, mid}`.

## Agreed decisions

Q1: Opt in with `conversions.fx: nbp`; manual FX objects keep working. The saved config keeps the marker, never resolved rates.

Q2: Use the current-table endpoint, never `/today/` or a computed date, so weekends and holidays get the last working day's table with its real `effectiveDate`.

Q3: Cache each table's raw response per `effectiveDate` in the workspace (`fx/nbp-a/`). A cached table for today (Warsaw) is used without a request; otherwise ask NBP for the latest table. Published tables are immutable, so entries are never overwritten and need no cleanup.

Q4: If NBP is unreachable or returns an invalid table, use the newest cached table and say so; with no cache, continue without rates and warn. Currency-dependent pay then needs clarification, as before.

Q5: Offer **Fetch from NBP automatically** in the preferences form alongside manual entry.

## Implementation

`jsf_search.nbp` (stdlib only) validates table A, converts mid rates to the existing FX contract (`base: pln`, `1 / mid`, dated and sourced by table), and owns the cache. `evaluate.criteria` accepts the marker; an unresolved marker evaluates like missing FX. `workflow.find_jobs` resolves it once before acquisition, reports the table in progress and the completion message, and records an `fx` summary in results and `last-search.json`. Conversions are not part of extraction cache keys, so new rates reevaluate reusable facts without AI.

## Verification

Offline tests use a recorded table A response: parsing and validation, conversion and a PLN-vs-USD pay comparison, today's cache hit without a request, weekend resolution to Friday's table, fallback on network, HTTP and invalid-response failures, corrupt cache entries, the unavailable path, preferences YAML and form round-trips, a full workflow search, and the server completion message. One live run against the real API fetched and cached table `205/A/NBP/2026`, then reused it without a request. No candidate workspace was used.
