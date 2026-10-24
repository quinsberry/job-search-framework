# Job Search Framework

Local-first job-search assistant: candidate profile, search preferences and vacancy discovery.

The app lives in [`web/`](web/README.md) (Bun + Next.js). Decisions are in [`docs/adr/`](docs/adr/), domain vocabulary in [`CONTEXT.md`](CONTEXT.md), specs and issues in `.scratch/`.

## Quick start

```bash
./run-web-app.sh
```

It checks for [Bun](https://bun.sh), installs dependencies, builds when needed and starts the app at <http://localhost:3000> (`PORT=3001 ./run-web-app.sh` for another port, `--rebuild` to force a build). It creates `web/.env` from `web/.env.example` on first run; add your `OPENROUTER_API_KEY` there for Search. On Windows, run it from WSL or Git Bash.

## Development

```bash
cd web && bun install && bun run dev
```

Licensed under MIT.
