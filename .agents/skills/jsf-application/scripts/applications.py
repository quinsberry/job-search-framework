"""Compatible command-line entrypoint; Python callers use jsf_application.applications."""
from jsf_application.applications import main

if __name__ == "__main__":
    raise SystemExit(main())
