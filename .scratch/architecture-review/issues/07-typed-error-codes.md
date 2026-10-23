# 07 — Replace string error codes with a typed error

Status: needs-triage
Type: task

Server errors carry their HTTP-facing code via `Object.assign(new Error(message), { code })` (`shared/http/server.ts`, `app/api/applications/run/route.ts`, `modules/applications/server/application-list.ts`), and `errorResponse` reads `code` back as an untyped string. About a dozen string codes are spread through the code, and on the client `RequestError.code` is a plain `string`. A typo in a code is not caught at compile time, and the client cannot exhaustively handle codes.

Introduce a shared `AppError` class with a `code` typed as a union of the known codes (for example `invalid`, `forbidden`, `not-found`, `conflict`, `unavailable`), and a status mapping in `errorResponse`. Share the code union with the client so `RequestError.code` is typed too. Keep the wire format (`{ error, code }`) and status codes unchanged.

Done when all coded errors use the class, no `Object.assign(new Error…, { code })` remains, and tests, typecheck and lint pass.

## Comments
