# vera-anchor

Local-first SDK for deterministic evidence generation and dataset anchoring for [Hash Factory](https://hf.veraanchor.com). Part of the [Vera Anchor](https://veraanchor.com) ecosystem.

Raw data never leaves your machine. Only derived evidence packages are submitted to Hash Factory when you choose to do so.

## Installation

```bash
npm install vera-anchor
```

Requires Node.js with ESM support.

## What it does

`vera-anchor` builds deterministic evidence packages on your machine composed of SHA3-512 hashes, Merkle proofs, bundle manifests, fingerprints, and receipts. It then optionally submits that evidence to Hash Factory for registration, HCS anchoring, publication, and certificate issuance.

Two operating modes:

- **Local only** — build evidence, inspect it, keep raw files private. No Hash Factory or Hedera network calls.
- **Local then submit** — build evidence locally, then submit the derived evidence package to Hash Factory.

## Dataset flow

For directory-backed datasets.

Dataset content identity is network-independent. The same canonical dataset produces the same bundle digest, dataset fingerprint, Merkle root, and evidence idempotency key regardless of whether it is later registered on Hedera testnet or mainnet.

For `register_and_anchor` operations, `hedera_network` identifies the target ledger and becomes part of the network-bound plan and receipt identity. For new integrations, explicitly provide either `"testnet"` or `"mainnet"` when submitting a dataset.

### Local only

Local-only dataset evidence is not bound to a Hedera network.

```js
import { executeDatasetAnchorLocalOnly } from "vera-anchor";

const result = await executeDatasetAnchorLocalOnly({
  identity: {
    dataset_key: "<org_id>.<program>.<name>",
    program: "my_program",
    version_label: "v1",
  },
  root_dir: "/path/to/dataset",
  evidence_pointer: "file:///path/to/dataset",
});

console.log(result.local.receipt);
console.log(result.local.evidence);
```

A local-only receipt does not contain `hedera_network`.

### Plan a dataset anchor

You can inspect the deterministic network-bound plan before submitting evidence:

```js
import { planDatasetAnchorRemote } from "vera-anchor";

const plan = await planDatasetAnchorRemote(
  {
    baseUrl: "https://hfapi.veraanchor.com",
    auth: { apiKey: process.env.HF_API_KEY },
  },
  {
    mode: "register_and_anchor",
    identity: {
      dataset_key: "<org_id>.<program>.<name>",
      program: "my_program",
      version_label: "v1",
    },
    hedera_network: "testnet",
    issue_certificate: false,
  }
);

console.log(plan.hedera_network);
console.log(plan.plan_id);
console.log(plan.steps);
```

For an explicitly network-bound plan, testnet and mainnet produce distinct plan identities while leaving the underlying dataset content identity unchanged.

### Local then submit to Hash Factory

```js
import { executeDatasetAnchorLocalThenSubmit } from "vera-anchor";

const result = await executeDatasetAnchorLocalThenSubmit(
  {
    baseUrl: "https://hfapi.veraanchor.com",
    auth: { apiKey: process.env.HF_API_KEY },
  },
  {
    identity: {
      dataset_key: "<org_id>.<program>.<name>",
      program: "my_program",
      version_label: "v1",
    },
    hedera_network: "testnet",
    root_dir: "/path/to/dataset",
    evidence_pointer: "file:///path/to/dataset",
    display_name: "My Dataset",
    publish_visibility: "unlisted",
    set_active: true,
    issue_certificate: false, // optional; omit to use server default behavior
  }
);

console.log(result.local.receipt);
console.log(result.remote.receipt);
console.log(result.remote.hedera_network);
```

Use `hedera_network: "mainnet"` only when you intend the registration and anchor operation to target Hedera mainnet.

The local evidence remains network-independent. The remote plan, registration, publication, and receipt are bound to the selected Hedera network.

### Verify

```js
import { verifyDatasetAnchorRemote } from "vera-anchor";

const result = await verifyDatasetAnchorRemote(
  {
    baseUrl: "https://hfapi.veraanchor.com",
    auth: { apiKey: process.env.HF_API_KEY },
  },
  {
    receipt,  // from a previous run
    bundle,   // from a previous run
    root_dir: "/path/to/dataset", // optional local consistency check
  }
);

console.log(result.receipt_verify?.ok);
console.log(result.bundle_verify?.ok);
console.log(result.local_verify?.ok);
```

Network-bound receipts carry their Hedera network identity inside the receipt. The network does not need to be supplied separately when verifying an existing receipt.

## Dataset network identity

Vera Anchor intentionally separates dataset content identity from ledger operation identity.

Network-independent dataset evidence includes:

- file hashes
- Merkle root
- bundle manifest
- bundle digest
- dataset fingerprint
- evidence idempotency key

Network-bound operation evidence includes:

- explicit anchor plan
- Hedera network
- registration and publication
- network-bound receipt

This allows the same dataset content to retain the same deterministic fingerprint across testnet and mainnet while still producing unambiguous records of where each anchor operation occurred.

## Ingest flow

For generic evidence objects — `file_set`, `file`, `text`, or `json`.

Ingest content identity is network-independent. The same canonical material produces the same item hashes, canonical leaf hashes, Merkle root, bundle digest, fingerprint, and evidence idempotency key regardless of whether it is later anchored on Hedera testnet or mainnet.

For `register_and_anchor` operations, `hedera_network` identifies the target ledger and becomes part of the explicit network-bound plan and final receipt identity. For new integrations, explicitly provide either `"testnet"` or `"mainnet"` when planning or submitting an ingest anchor.

For submit flows, use an org-scoped ingest domain:

```text
hf:ingest|org:<org_uuid>
```

For `text` and `json` material, set an explicit `evidence_pointer`. These material kinds do not infer a default pointer from a filesystem path.

### Local only

```js
import { ingest } from "vera-anchor";

const result = await ingest.executeIngestLocalOnly({
  request: {
    mode: "merkle_only",
    identity: {
      object_key: "my_object",
      object_kind: "file_set",
      program: "my_program",
      version_label: "v1",
    },
    material: {
      kind: "file_set",
      root_dir: "/path/to/input",
      rules: { follow_symlinks: false },
    },
    evidence_pointer: "file:///path/to/input",
  },
});
```

Local-only ingest evidence and the local receipt are not bound to a Hedera network.

### Plan an ingest anchor

You can inspect the explicit network-bound plan before submitting evidence:

```js
import { ingest } from "vera-anchor";

const plan = await ingest.planIngestRemote(
  {
    baseUrl: "https://hfapi.veraanchor.com",
    auth: { apiKey: process.env.HF_API_KEY },
  },
  {
    mode: "register_and_anchor",
    identity: {
      object_key: "my_object",
      object_kind: "file_set",
      program: "my_program",
      version_label: "v1",
    },
    material: {
      kind: "file_set",
      root_dir: "/path/to/input",
      rules: { follow_symlinks: false },
    },
    domain: "hf:ingest|org:<org_uuid>",
    proof_date: "2026-09-09",
    hedera_network: "testnet",
    issue_certificate: false,
  }
);

console.log(plan.hedera_network);
console.log(plan.plan_id);
console.log(plan.steps);
```

Explicit testnet and mainnet plans have distinct network-bound plan identities while leaving the underlying Ingest content evidence unchanged.

### Local then submit

```js
import { ingest } from "vera-anchor";

const result = await ingest.executeIngestLocalThenSubmit(
  {
    baseUrl: "https://hfapi.veraanchor.com",
    auth: { apiKey: process.env.HF_API_KEY },
  },
  {
    request: {
      mode: "register_and_anchor",
      identity: {
        object_key: "my_object",
        object_kind: "file_set",
        program: "my_program",
        version_label: "v1",
      },
      material: {
        kind: "file_set",
        root_dir: "/path/to/input",
        rules: { follow_symlinks: false },
      },
      evidence_pointer: "file:///path/to/input",
      domain: "hf:ingest|org:<org_uuid>",
      proof_date: "2026-03-23",
      hedera_network: "testnet",
      issue_certificate: false, // optional; omit to use server default behavior
    },
  }
);
```

The local evidence and local pre-submit receipt remain network-independent. The remote result and final receipt are bound to the selected Hedera network.

### Verify

```js
import { ingest } from "vera-anchor";

const result = await ingest.verifyIngestRemote(
  {
    baseUrl: "https://hfapi.veraanchor.com",
    auth: { apiKey: process.env.HF_API_KEY },
  },
  {
    receipt, // from a previous anchored run
    bundle,  // from a previous run
    root_dir: "/path/to/input", // optional local file_set consistency check
  },
  {
    hederaNetwork: "testnet",
  }
);

console.log(result.receipt_verify?.ok);
console.log(result.bundle_verify?.ok);
console.log(result.artifact_binding?.ok);
console.log(result.network_binding?.ok);
console.log(result.local_verify?.ok);
```

The third argument is optional. When `hederaNetwork` is supplied, the SDK sends it as the HF verification network selector. HF then verifies that the network-bound receipt agrees with that requested network. The selector does not become part of the bundle or content evidence.

## Ingest network identity

Vera Anchor intentionally separates Ingest content evidence from ledger operation identity.

Network-independent Ingest evidence includes:

- item content hashes
- canonical ingest leaf hashes
- Merkle root
- bundle manifest and bundle digest
- fingerprint
- evidence idempotency key
- local receipt

Network-bound operation evidence includes:

- explicit `register_and_anchor` plan
- Hedera network
- anchor and publication records
- final network-bound receipt

This lets identical canonical content retain the same deterministic evidence across testnet and mainnet while producing unambiguous records of where each ledger operation occurred.

## Example scripts

The package includes runnable example scripts:

| Script | Description |
|---|---|
| `scripts/example-dataset-local-only.mjs` | Local-only dataset evidence generation |
| `scripts/example-dataset-local-submit.mjs` | Local build + network-bound submit to Hash Factory |
| `scripts/example-dataset-verify.mjs` | Verify a dataset receipt and bundle |
| `scripts/example-ingest-local-only.mjs` | Local-only, network-independent ingest evidence generation |
| `scripts/example-ingest-local-submit.mjs` | Local evidence + explicit network-bound plan and submit to Hash Factory |
| `scripts/example-ingest-verify.mjs` | Verify receipt, bundle, artifact binding, network binding, and optional local material |

Run a dataset submit example:

```bash
HF_API_KEY=your_key \
HF_BASE_URL=https://hfapi.veraanchor.com \
TEST_HEDERA_NETWORK=testnet \
TEST_ROOT_DIR=/path/to/dataset \
TEST_DATASET_KEY=<org_id>.<program>.<name> \
TEST_EVIDENCE_POINTER=s3://your-bucket/path \
TEST_ISSUE_CERTIFICATE=false \
node scripts/example-dataset-local-submit.mjs
```

`TEST_HEDERA_NETWORK` must be either `testnet` or `mainnet`.

The dataset submit example checks that:

- the anchor plan identifies the requested Hedera network;
- local and remote dataset fingerprints match;
- local and remote bundle digests match;
- local and remote Merkle roots match;
- the remote response and receipt identify the requested network;
- returned Core dataset and version identities agree with the requested network;
- the local hash-only receipt remains network-independent.

Run a dataset verify example:

```bash
HF_API_KEY=your_key \
HF_BASE_URL=https://hfapi.veraanchor.com \
TEST_RECEIPT_PATH=./vera_anchor_dataset_receipts/latest/remote-receipt.json \
TEST_BUNDLE_PATH=./vera_anchor_dataset_receipts/latest/remote-bundle.json \
TEST_EXPECTED_HEDERA_NETWORK=testnet \
node scripts/example-dataset-verify.mjs
```

`TEST_EXPECTED_HEDERA_NETWORK` is optional. When supplied, the example checks the receipt's network before performing remote verification.

Run a local-only dataset example:

```bash
TEST_ROOT_DIR=/path/to/dataset \
TEST_DATASET_KEY=<org_id>.<program>.<name> \
TEST_EVIDENCE_POINTER=file:///path/to/dataset \
node scripts/example-dataset-local-only.mjs
```

`TEST_HEDERA_NETWORK` may optionally be supplied to the local-only example as a future submit target, but it is not incorporated into local evidence or the local hash-only receipt.

Run an ingest submit example:

```bash
HF_API_KEY=your_key \
HF_BASE_URL=https://hfapi.veraanchor.com \
TEST_OBJECT_KIND=file_set \
TEST_OBJECT_KEY=my_object \
TEST_PROGRAM=my_program \
TEST_VERSION_LABEL=v1 \
TEST_ROOT_DIR=/path/to/input \
TEST_DOMAIN='hf:ingest|org:<org_uuid>' \
TEST_HEDERA_NETWORK=testnet \
TEST_EVIDENCE_POINTER=file:///path/to/input \
TEST_ISSUE_CERTIFICATE=false \
node scripts/example-ingest-local-submit.mjs
```

`TEST_HEDERA_NETWORK` is required by the ingest submit example and must be either `testnet` or `mainnet`. Use `mainnet` only when you intend the example to create a mainnet ledger operation.

The ingest submit example checks that:

- the explicit plan identifies the requested Hedera network;
- local and remote fingerprints match;
- local and remote bundle digests match;
- local and remote Merkle roots match;
- the remote result and final receipt identify the requested network;
- any returned Core network claims agree with the requested network;
- the local pre-submit receipt remains network-independent.

The submit example writes both per-run artifacts and a `latest` directory:

```text
remote-plan.json
local-receipt.json
local-evidence.json
remote-receipt.json
remote-bundle.json
remote-payload.json
run-meta.json
```

Run an ingest verify example:

```bash
HF_API_KEY=your_key \
HF_BASE_URL=https://hfapi.veraanchor.com \
TEST_RECEIPT_PATH=./vera_anchor_ingest_receipts/latest/remote-receipt.json \
TEST_BUNDLE_PATH=./vera_anchor_ingest_receipts/latest/remote-bundle.json \
TEST_EXPECTED_HEDERA_NETWORK=testnet \
node scripts/example-ingest-verify.mjs
```

`TEST_EXPECTED_HEDERA_NETWORK` is optional. When supplied, `TEST_RECEIPT_PATH` is required and the SDK forwards the expected network to HF verification. The example requires the returned `network_binding` result to confirm that the receipt and requested network match.

For local-only Ingest generation, `TEST_HEDERA_NETWORK` may optionally be supplied as a future submit target. It is shown in the script output but is deliberately not passed into local evidence generation or incorporated into the local receipt.

## Hash Factory

[hf.veraanchor.com](https://hf.veraanchor.com) — live deployment.

The Vera Anchor Hash Factory is the web interface where users onboard, manage evidence packages, register and anchor datasets, view HCS anchors, and receive supported HTS certificate NFTs on Hedera.

## License

MIT + Commons Clause — full license text:

https://github.com/VeraAnchor/vera-anchor-js/blob/main/LICENSE