# 25 — Move NDJSON reading and error parsing into the shared HTTP client

Status: needs-triage
Type: task

`modules/applications/client/api.ts` contains `readEvents`, a generic NDJSON parser (buffering split lines, final flush, per-line schema validation), and `runSearch`, which re-implements the `{ error, code }` error parsing that `shared/http/client.ts` `request()` already performs.

Move into `shared/http/client.ts`:

- `readNdjson(body, schema)`: the current `readEvents`, generic over the event schema;
- a `streamRequest(url, input, schema, signal)` that sends the POST, maps non-OK responses through the same error parsing as `request()` and yields validated events;
- a private `responseError(response)` used by both `request()` and `streamRequest()`.

`runSearch` becomes a one-line call. This is the client-side counterpart of the server NDJSON helper in issue 06; keep the two in step (newline-delimited JSON, one event per line). Update `app/api/applications/run/route.test.ts`, which imports `readEvents` from the feature today.

Done when no feature parses NDJSON or error bodies itself and tests, typecheck and lint pass.

## Comments
