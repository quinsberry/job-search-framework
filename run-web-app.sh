#!/usr/bin/env bash
# Installs, builds and starts the web app. Usage: ./run-web-app.sh [--rebuild]
# Set PORT to use a port other than 3000.
set -euo pipefail

WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/web"
PORT="${PORT:-3000}"
REBUILD=false

for arg in "$@"; do
	case "$arg" in
		--rebuild) REBUILD=true ;;
		-h | --help)
			echo "Usage: ./run-web-app.sh [--rebuild]   (PORT=3001 ./run-web-app.sh for another port)"
			exit 0
			;;
		*)
			echo "Unknown option: $arg" >&2
			exit 1
			;;
	esac
done

# Colours and the spinner only when writing to a terminal.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
	TTY=true BOLD=$'\033[1m' DIM=$'\033[2m' RED=$'\033[31m' GREEN=$'\033[32m' YELLOW=$'\033[33m' CYAN=$'\033[36m' RESET=$'\033[0m'
else
	TTY=false BOLD='' DIM='' RED='' GREEN='' YELLOW='' CYAN='' RESET=''
fi

FRAMES=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏)
# Draws one spinner frame for "$1", started at $2 (SECONDS); $3 is the frame counter.
spin() { printf '\r%s%s%s %s %s(%ss)%s' "$CYAN" "${FRAMES[$3 % 10]}" "$RESET" "$1" "$DIM" $((SECONDS - $2)) "$RESET"; }
clear_line() { if [ "$TTY" = true ]; then printf '\r\033[K'; fi; }

ok() { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$RESET" "$1"; }
hint() { printf '  %s\n' "$@"; }
fail() {
	printf '%s✗ %s%s\n' "$RED" "$1" "$RESET" >&2
	shift
	[ $# -gt 0 ] && hint "$@" >&2
	exit 1
}

# Runs a command with a spinner and its output hidden; shows the output only if it fails.
run_step() {
	local label="$1" log pid start frame=0
	shift
	log="$(mktemp)"
	start=$SECONDS
	"$@" >"$log" 2>&1 &
	pid=$!
	if [ "$TTY" = true ]; then
		while kill -0 "$pid" 2>/dev/null; do
			spin "$label" "$start" $((frame++))
			sleep 0.1
		done
	fi
	clear_line
	if wait "$pid"; then
		ok "$label ${DIM}($((SECONDS - start))s)${RESET}"
		rm -f "$log"
	else
		printf '%s✗ %s%s\n\n' "$RED" "$label" "$RESET" >&2
		cat "$log" >&2
		rm -f "$log"
		exit 1
	fi
}

printf '\n%sJob Search Framework%s\n\n' "$BOLD" "$RESET"

# 1. Bun
if ! command -v bun >/dev/null 2>&1; then
	case "$(uname -s)" in
		Darwin) if command -v brew >/dev/null 2>&1; then install="brew install oven-sh/bun/bun"; else install="curl -fsSL https://bun.sh/install | bash"; fi ;;
		MINGW* | MSYS* | CYGWIN*) install='powershell -c "irm bun.sh/install.ps1 | iex"' ;;
		*) install="curl -fsSL https://bun.sh/install | bash   (needs unzip)" ;;
	esac
	fail "Bun is not installed. Install it with:" "" "  $install" "" "Then open a new terminal and run ./run-web-app.sh again."
fi

required="$(sed -n 's/.*"packageManager": *"bun@\([0-9.]*\)".*/\1/p' "$WEB_DIR/package.json")"
installed="$(bun --version)"
# True when version $1 is older than version $2.
version_lt() {
	[ "$1" = "$2" ] && return 1
	[ "$(printf '%s\n%s\n' "$1" "$2" | sort -t. -k1,1n -k2,2n -k3,3n | head -n1)" = "$1" ]
}
if [ -n "$required" ] && version_lt "$installed" "$required"; then
	brew_prefix="$(command -v brew >/dev/null 2>&1 && brew --prefix || true)"
	if [ -n "$brew_prefix" ] && [[ "$(command -v bun)" == "$brew_prefix"/* ]]; then
		upgrade="brew upgrade bun"
	else
		upgrade="bun upgrade"
	fi
	fail "Bun $installed is too old; this app needs $required or newer." "Run: $upgrade"
fi
ok "Bun $installed"

cd "$WEB_DIR"

# 2. Dependencies (a no-op when already up to date)
run_step "Dependencies installed" bun install --frozen-lockfile

# 3. Environment
if [ ! -f .env ]; then
	cp .env.example .env
	ok "Created web/.env from web/.env.example"
fi
key_set=false
[ -n "${OPENROUTER_API_KEY:-}" ] && key_set=true
for file in .env.local .env; do
	[ -f "$file" ] && grep -qE '^OPENROUTER_API_KEY=.+' "$file" && key_set=true
done
if [ "$key_set" = true ]; then
	ok "OpenRouter API key found"
else
	warn "OPENROUTER_API_KEY is not set, so Search will not work."
	hint "Get a key at https://openrouter.ai/keys, put it in $WEB_DIR/.env" "(OPENROUTER_API_KEY=...), then restart this script."
fi

# 4. Build when missing, outdated or forced
if [ "$REBUILD" = true ] || [ ! -f .next/BUILD_ID ] ||
	[ -n "$(find src public package.json bun.lock next.config.ts tsconfig.json .env* -newer .next/BUILD_ID 2>/dev/null | head -n1)" ]; then
	run_step "App built" bun run build
else
	ok "Build is up to date"
fi

# 5. Start
if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
	fail "Port $PORT is already in use." "Run with another port, e.g.: PORT=$((PORT + 1)) ./run-web-app.sh"
fi

server_log="$(mktemp)"
bun --bun node_modules/.bin/next start --hostname 127.0.0.1 --port "$PORT" >"$server_log" 2>&1 &
server_pid=$!
tail_pid=''
stop() {
	trap - INT TERM EXIT
	kill "$server_pid" $tail_pid 2>/dev/null || true
	wait "$server_pid" 2>/dev/null || true
	rm -f "$server_log"
}
trap 'stop; printf "\n%sStopped.%s\n" "$DIM" "$RESET"; exit 0' INT TERM
trap stop EXIT

# Wait until the server answers (or dies), with the same spinner.
start=$SECONDS frame=0
until curl -s -o /dev/null "http://127.0.0.1:$PORT" 2>/dev/null; do
	if ! kill -0 "$server_pid" 2>/dev/null; then
		clear_line
		printf '%s✗ The app failed to start%s\n\n' "$RED" "$RESET" >&2
		cat "$server_log" >&2
		exit 1
	fi
	if [ "$TTY" = true ]; then spin "Starting the app" "$start" $((frame++)); fi
	sleep 0.1
done
clear_line
ok "App started"

printf '\n  %sOpen %shttp://localhost:%s%s%s in your browser.%s\n' "$BOLD" "$CYAN" "$PORT" "$RESET" "$BOLD" "$RESET"
printf '  %sPress Ctrl+C to stop.%s\n\n' "$DIM" "$RESET"
printf '  %sCV conversion needs the Codex CLI (codex login) or Claude Code CLI (claude auth login,%s\n' "$DIM" "$RESET"
printf '  %sor JSF_CLAUDE_AUTH=bedrock with AWS settings; see web/.env.example).%s\n\n' "$DIM" "$RESET"

# From here on, show only what the server prints after its startup banner (errors, mostly).
tail -n +"$(($(wc -l <"$server_log") + 1))" -f "$server_log" &
tail_pid=$!
disown "$tail_pid"
# Ctrl+C reaches the server too; it exits with 130 (SIGINT) or 143 (SIGTERM).
status=0
wait "$server_pid" || status=$?
case "$status" in
	0 | 130 | 143) printf '\n%sStopped.%s\n' "$DIM" "$RESET" ;;
	*) fail "The app stopped unexpectedly (output above)." ;;
esac
