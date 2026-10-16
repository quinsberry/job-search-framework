"""Compatible command-line entrypoint; Python callers use jsf_profile.profile."""
from jsf_profile.profile import main

if __name__ == "__main__":
    raise SystemExit(main())
