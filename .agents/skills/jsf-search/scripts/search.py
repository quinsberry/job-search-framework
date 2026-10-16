"""Compatible command-line entrypoint; Python callers use jsf_search.search."""
from jsf_search.search import main

if __name__ == "__main__":
    raise SystemExit(main())
