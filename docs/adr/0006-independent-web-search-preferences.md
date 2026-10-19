# Independent web search preferences with recoverable YAML drafts

The Bun/Next.js app owns one manually edited search configuration per workspace under `search-preferences/`, independently of candidate-profile facts. `config.yaml` holds validated active preferences; `draft.yaml` retains incomplete form input, and only explicit Save publishes it through atomic replacement and revision checks. A publication marker in the config envelope prevents an interrupted draft cleanup from resurrecting an already-saved draft.

Profile and Search share typed form controls, ordered draft recovery and safe filesystem mechanics; each owns its validation, storage envelopes and feature-specific behavior. This avoids a generic editor framework while preserving durable recovery in both editors. New and touched code prefers Bun built-ins where they provide the required guarantees; exclusive temporary-file creation, rename, locking and symlink protection retain Node APIs where needed.

Confirmed Discard waits for in-flight writes without flushing the values being discarded, including after a recovery failure. External changes are detected on writes, focus refetch and explicit reload; observations expose conflicts without replacing local edits or silently rebasing their write revision. Continuous preferences polling and filesystem watchers are outside scope.
