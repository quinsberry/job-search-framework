# Separate live vacancy discovery from pure evaluation

`jsf-search` acquires changing external listings, then evaluates fixed vacancy evidence against explicit search criteria and conversion inputs. The user chose this boundary so evaluation can be reproducible and idempotent while sources remain pluggable; identical live requests cannot guarantee identical listings. The skill owns discovery and fit assessment, while application tracking and salary research remain separate skills rather than becoming responsibilities of search.

Structured fact extraction and its supporting evidence belong to acquisition, because free-text interpretation may vary. Snapshot replay evaluates saved facts using deterministic rules; reinterpretation is an explicit new operation rather than an implicit part of replay.

Search deduplicates listings within the current acquisition, including confirmed cross-source identities, but does not read previous results or maintain search history. The user chose to delegate cross-run deduplication to another skill to keep persistent history outside search's responsibility. Stable vacancy identities and provenance in search results support that downstream operation.
