# Changelog

All notable changes to `vera-anchor` will be documented here.

## [0.2.0] — 2026-09-15

### Added

- Hedera network support for Dataset `register_and_anchor` planning,
  submission, receipts, and verification workflows.
- Hedera network support for Ingest `register_and_anchor` planning,
  submission, receipts, and verification workflows.
- Explicit `testnet` and `mainnet` ledger targeting for network-bound
  Dataset and Ingest operations.
- Dataset v1 golden-vector conformance tests covering deterministic evidence,
  hash-only receipts, network-bound plans, network-bound receipts, and receipt
  tamper detection.
- Ingest v1 golden-vector conformance tests covering JSON, text, file, and
  file-set evidence, deterministic receipts, artifact binding, and
  network-bound plan and receipt behavior.
- Cross-platform conformance-vector distribution integrity checks with
  LF/CRLF-stable SHA-256 manifests.
- Ingest path-normalization parity coverage for portable relative paths and
  fail-closed rejection of absolute paths, parent escapes, drive paths,
  control characters, and other unsafe path forms.
- Ingest remote network-boundary regression coverage exercising the real HTTP
  transport path and network propagation across plan, execute, submit, and
  verify operations.

### Changed

- Dataset and Ingest content evidence remains network-independent: canonical
  content retains the same hashes, Merkle roots, bundle digests, fingerprints,
  and evidence idempotency keys regardless of the eventual Hedera network.
- Explicit ledger plans and final remote receipts are now network-bound so
  otherwise identical testnet and mainnet operations have distinct operation
  identities.
- Local-only and local pre-submit receipts remain independent of Hedera
  network selection.
- Dataset and Ingest example scripts now validate requested Hedera network
  identity across planning, submission, returned receipts, and applicable
  Core response fields.
- Verification flows now support validating network-bound receipts without
  incorporating Hedera network identity into the underlying content evidence.

## [0.1.0] — 2026-04-06

### Added
- Initial public release
- Local-only dataset evidence generation (`example_dataset_local_only`)
- Local-then-submit dataset flow (`example_dataset_local_submit`)
- Remote dataset verification (`example_dataset_verify`)
- Local-only ingest evidence generation (`example_ingest_local_only`)
- Local-then-submit ingest flow (`example_ingest_local_submit`)
- Remote ingest verification (`example_ingest_verify`)
- Example scripts for all six flows