"""Compatible command-line entrypoint; Python callers use jsf_vacancies.vacancies."""
from jsf_vacancies.vacancies import main

if __name__ == "__main__":
    raise SystemExit(main())
