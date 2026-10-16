"""Compatible command-line entrypoint; Python callers use jsf_workflow.workflow."""
from jsf_workflow.workflow import main

if __name__ == "__main__":
    raise SystemExit(main())
