// ============================================================================
// File: tests/conformance/ingest/pathNormParity.test.mjs
// Version: 1.0.0-ingest-path-normalization-parity | 2026-09-09
// Purpose:
//   Regression coverage for JS SDK Ingest path normalization parity.
// Notes:
//   - Runs against the built SDK distribution using Node's native test runner.
//   - Locks the backend-compatible relative-path normalization contract.
//   - Parent escapes, absolute paths, drive paths, and control chars fail closed.
// ============================================================================

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  normalizeRelPath,
} from "../../../dist/ingest/pathNorm.js";

describe("Ingest path normalization parity", () => {
  test("normalizes portable relative path spellings to the backend-compatible form", () => {
    const cases = [
      [
        "foo/bar.txt",
        "foo/bar.txt",
      ],
      [
        "./foo/bar.txt",
        "foo/bar.txt",
      ],
      [
        ".\\foo\\bar.txt",
        "foo/bar.txt",
      ],
      [
        "foo\\bar.txt",
        "foo/bar.txt",
      ],
      [
        "foo//bar.txt",
        "foo/bar.txt",
      ],
      [
        "foo/./bar.txt",
        "foo/bar.txt",
      ],
      [
        "foo/nested/../bar.txt",
        "foo/bar.txt",
      ],
    ];

    for (const [input, expected] of cases) {
      assert.equal(
        normalizeRelPath(input),
        expected,
        `unexpected normalization for ${JSON.stringify(input)}`,
      );
    }
  });

  test("rejects empty, absolute, drive-qualified, parent-escaping, and control-character paths", () => {
    const rejected = [
      "",
      "   ",
      "/absolute/path.txt",
      "\\absolute\\path.txt",
      "\\\\server\\share\\file.txt",
      "C:\\temp\\file.txt",
      "D:/temp/file.txt",
      "../outside.txt",
      "foo/../../outside.txt",
      "foo/\u0000bar.txt",
      "foo/\u001Fbar.txt",
      "foo/\u007Fbar.txt",
    ];

    for (const input of rejected) {
      assert.throws(
        () => normalizeRelPath(input),
        (error) =>
          error != null &&
          typeof error === "object" &&
          error.code === "PATH_INVALID",
        `expected PATH_INVALID for ${JSON.stringify(input)}`,
      );
    }
  });
});