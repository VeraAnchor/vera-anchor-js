# hf-local

Local-first SDK for deterministic evidence generation and dataset anchoring for [Hash Factory](https://hf.veraanchor.com). Part of the [Vera Anchor](https://veraanchor.com) ecosystem.

Raw data never leaves your machine. Only derived evidence packages are submitted to Hash Factory when you choose to do so.

## Installation

```bash
npm install hf-local
```

Requires Node.js with ESM support.

## What it does

`hf-local` builds deterministic evidence packages on your machine composed of SHA3-512 hashes, Merkle proofs, bundle manifests, fingerprints, and receipts. It then optionally submits that evidence to Hash Factory for registration, HCS anchoring, and certificate issuance.

Two operating modes:

- **Local only** — build evidence, inspect it, keep raw files private. No network calls.
- **Local then submit** — build evidence locally, then send the evidence package to Hash Factory.

## Dataset flow

For directory-backed datasets.

### Local only

```js
import { executeDatasetAnchorLocalOnly } from "hf-local";

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

### Local then submit to Hash Factory

```js
import { executeDatasetAnchorLocalThenSubmit } from "hf-local";

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
```

### Verify

```js
import { verifyDatasetAnchorRemote } from "hf-local";

const result = await verifyDatasetAnchorRemote(
  {
    baseUrl: "https://hfapi.veraanchor.com",
    auth: { apiKey: process.env.HF_API_KEY },
  },
  {
    receipt,   // from a previous run
    bundle,    // from a previous run
    root_dir: "/path/to/dataset",  // optional local consistency check
  }
);
```

## Ingest flow

For generic evidence objects — `file_set`, `file`, `text`, or `json`.

For submit flows, use an org-scoped ingest domain:

`hf:ingest|org:<org_uuid>`

For `text` and `json` material, set an explicit `evidence_pointer`. These
material kinds do not infer a default pointer from a filesystem path.

### Local only

```js
import { ingest } from "hf-local";

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

### Local then submit

```js
import { ingest } from "hf-local";

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
      issue_certificate: false, // optional; omit to use server default behavior
    },
  }
);
```

## Example scripts

The package includes runnable example scripts:

| Script | Description |
|---|---|
| `scripts/example-dataset-local-only.mjs` | Local-only dataset evidence generation |
| `scripts/example-dataset-local-submit.mjs` | Local build + submit to Hash Factory |
| `scripts/example-dataset-verify.mjs` | Verify a receipt and bundle |
| `scripts/example-ingest-local-only.mjs` | Local-only ingest evidence generation |
| `scripts/example-ingest-local-submit.mjs` | Local ingest + submit to Hash Factory |
| `scripts/example-ingest-verify.mjs` | Verify an ingest receipt and bundle |


Run a dataset submit example:

```bash
HF_API_KEY=your_key \
HF_BASE_URL=https://hfapi.veraanchor.com \
TEST_ROOT_DIR=/path/to/dataset \
TEST_DATASET_KEY=<org_id>.<program>.<name> \
TEST_EVIDENCE_POINTER=s3://your-bucket/path \
TEST_ISSUE_CERTIFICATE=false \
node scripts/example-dataset-local-submit.mjs
```

Run an ingest submit example:

```bash
HF_API_KEY=your_key \
HF_BASE_URL=https://hfapi.veraanchor.com \
TEST_OBJECT_KIND=file_set \
TEST_OBJECT_KEY=my_object \
TEST_PROGRAM=my_program \
TEST_VERSION_LABEL=v1 \
TEST_ROOT_DIR=/path/to/input \
TEST_DOMAIN=hf:ingest|org:<org_uuid> \
TEST_EVIDENCE_POINTER=file:///path/to/input \
TEST_ISSUE_CERTIFICATE=false \
node scripts/example-ingest-local-submit.mjs
```

## Hash Factory

[hf.veraanchor.com](https://hf.veraanchor.com) — live deployment.

The Vera Anchor Hash Factory is the web interface where users onboard, manage evidence packages, view HCS anchors, and receive HTS certificate NFTs on Hedera.

## License

MIT — see [LICENSE](./LICENSE).