# Alpha.1 offline fixtures

This directory is the offline publication fixture: it contains the clean DeepSeek Harness 0.1.2-alpha.1 closure, the locked third-party runtime graph, and the unshipped dsh-model-switch 0.4.2 type fixture. These archives are test inputs only and are not dependencies or files shipped by dsh-llm-grok.

## Provenance

[PROVENANCE.json](./PROVENANCE.json) records the source tag, verified commit, package identities, byte counts, SHA-256 values, and resolved dependency identities from lock snapshots. The recorded source is a git archive of the official repository commit; no package manifest or source declaration was changed while creating these tarballs.

## Regeneration

Obtain and verify the recorded tag and commit, run its pinned install and build, pack the package closure into `tarballs/`, include required runtime peers and document intentionally omitted platform-optional packages, recompute [PROVENANCE.json](./PROVENANCE.json), and run `pnpm run pack:check`. Do not substitute release candidates, later alpha releases, source links, or workspace aliases.
