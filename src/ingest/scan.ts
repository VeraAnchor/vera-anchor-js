// ============================================================================
// File: src/ingest/scan.ts
// Version: 1.0-hf-ingest-scan-v1 | 2026-03-06
// Purpose:
//   Local filesystem scan for generic ingest workflows.
// Notes:
//   - Deterministic file discovery.
//   - Default: do not follow symlinks.
//   - Skip non-regular files.
//   - Supports image, csv, fasta, json, and general text/binary artifacts.
//   - Deterministic ordering by normalized relative path.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import type { IngestRules, ScannedFile } from "./types.js";
import {
  MAX_FILES_DEFAULT,
  MAX_ROOT_SCAN_DEPTH,
  MAX_SINGLE_FILE_BYTES_DEFAULT,
  MAX_TOTAL_BYTES_DEFAULT,
  MAX_GLOB_LEN,
  MAX_SUFFIX_LEN,
} from "./limits.js";
import { IngestError } from "./errors.js";
import { normalizeRelPath } from "./pathNorm.js";

export type ScanProgress = Readonly<{
  event: "dir" | "file" | "skip";
  rel?: string;
  reason?: string;
  files_seen?: number;
  total_bytes_seen?: number;
}>;

function asBool(v: unknown, def: boolean): boolean {
  return v === undefined ? def : Boolean(v);
}

function asInt(v: unknown, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function normSuffixes(v: unknown): ReadonlyArray<string> | null {
  if (!v) return null;
  if (!Array.isArray(v)) {
    throw new IngestError("allowed_suffixes_invalid", { code: "RULES_INVALID", statusCode: 400 });
  }

  const out: string[] = [];
  for (const x of v) {
    const s = String(x ?? "").trim().toLowerCase();
    if (!s) continue;
    if (!s.startsWith(".")) {
      throw new IngestError("allowed_suffixes_must_start_dot", { code: "RULES_INVALID", statusCode: 400 });
    }
    if (s.length > MAX_SUFFIX_LEN) {
      throw new IngestError("allowed_suffixes_too_long", { code: "RULES_INVALID", statusCode: 400 });
    }
    out.push(s);
  }

  return out.length ? Object.freeze(out.slice()) : null;
}

function matchesSuffix(name: string, allowed: ReadonlyArray<string> | null): boolean {
  if (!allowed || !allowed.length) return true;
  const low = name.toLowerCase();
  for (const suf of allowed) {
    if (low.endsWith(suf)) return true;
  }
  return false;
}

function normGlobs(v: unknown, label: string): ReadonlyArray<string> | null {
  if (v == null) return null;
  if (!Array.isArray(v)) {
    throw new IngestError(`${label}_invalid`, { code: "RULES_INVALID", statusCode: 400 });
  }

  const out: string[] = [];
  for (const x of v) {
    const s = String(x ?? "").trim();
    if (!s) continue;
    if (s.length > MAX_GLOB_LEN) {
      throw new IngestError(`${label}_too_long`, { code: "RULES_INVALID", statusCode: 400 });
    }
    out.push(s);
  }

  return out.length ? Object.freeze(out.slice()) : null;
}

function compileGlobFilter(
  includeGlobs: ReadonlyArray<string> | null,
  excludeGlobs: ReadonlyArray<string> | null
): (pathRelPosix: string) => boolean {
  const inc =
    includeGlobs && includeGlobs.length
      ? picomatch(includeGlobs as any, { dot: true, posixSlashes: true, nocase: false })
      : null;

  const exc =
    excludeGlobs && excludeGlobs.length
      ? picomatch(excludeGlobs as any, { dot: true, posixSlashes: true, nocase: false })
      : null;

  return (pathRelPosix: string): boolean => {
    if (exc && exc(pathRelPosix)) return false;
    if (inc) return Boolean(inc(pathRelPosix));
    return true;
  };
}

async function realpathSafe(p: string): Promise<string> {
  try {
    return await fs.promises.realpath(p);
  } catch (cause) {
    throw new IngestError("realpath_failed", {
      code: "SCAN_FAILED",
      statusCode: 500,
      cause,
    });
  }
}

function ensureUnderRoot(rootReal: string, targetReal: string): void {
  const root = rootReal.endsWith(path.sep) ? rootReal : `${rootReal}${path.sep}`;
  if (targetReal === rootReal) return;
  if (!targetReal.startsWith(root)) {
    throw new IngestError("symlink_escapes_root", {
      code: "SYMLINK_ESCAPE",
      statusCode: 400,
    });
  }
}

export async function scanIngestFiles(
  rootDir: string,
  rules?: IngestRules,
  onProgress?: (p: ScanProgress) => void
): Promise<ReadonlyArray<ScannedFile>> {
  const root = path.resolve(String(rootDir ?? ""));
  if (!root) {
    throw new IngestError("root_dir_missing", { code: "ROOT_INVALID", statusCode: 400 });
  }

  let st: fs.Stats;
  try {
    st = await fs.promises.lstat(root);
  } catch (cause) {
    throw new IngestError("root_dir_not_found", {
      code: "ROOT_INVALID",
      statusCode: 400,
      cause,
    });
  }

  if (!st.isDirectory()) {
    throw new IngestError("root_dir_not_directory", {
      code: "ROOT_INVALID",
      statusCode: 400,
    });
  }

  const rootReal = await realpathSafe(root);
  const followSymlinks = asBool(rules?.follow_symlinks, false);
  const maxFiles = Math.max(1, asInt(rules?.max_files, MAX_FILES_DEFAULT));
  const maxTotalBytes = Math.max(0, asInt(rules?.max_total_bytes, MAX_TOTAL_BYTES_DEFAULT));
  const maxSingleFile = Math.max(0, asInt(rules?.max_single_file_bytes, MAX_SINGLE_FILE_BYTES_DEFAULT));

  const allowedSuffixes = normSuffixes(rules?.allowed_suffixes);
  const includeGlobs = normGlobs(rules?.include_globs, "include_globs");
  const excludeGlobs = normGlobs(rules?.exclude_globs, "exclude_globs");
  const allowPath = compileGlobFilter(includeGlobs, excludeGlobs);

  const out: ScannedFile[] = [];
  let totalBytes = 0;

  type QItem = Readonly<{
    abs: string;
    rel: string;
    depth: number;
  }>;

  const q: QItem[] = [{ abs: root, rel: "", depth: 0 }];
  const visitedDirReals = new Set<string>([rootReal]);

  while (q.length) {
    const cur = q.shift() as QItem;

    if (cur.depth > MAX_ROOT_SCAN_DEPTH) {
      throw new IngestError("scan_depth_exceeded", {
        code: "SCAN_LIMIT",
        statusCode: 400,
      });
    }

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(cur.abs, { withFileTypes: true });
    } catch (cause) {
      throw new IngestError("scan_readdir_failed", {
        code: "SCAN_FAILED",
        statusCode: 500,
        cause,
      });
    }

    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    onProgress?.({
      event: "dir",
      rel: cur.rel || ".",
      files_seen: out.length,
      total_bytes_seen: totalBytes,
    });

    for (const ent of entries) {
      const abs = path.join(cur.abs, ent.name);
      const relRaw = cur.rel ? `${cur.rel}/${ent.name}` : ent.name;
      const rel = normalizeRelPath(relRaw);

      if (!allowPath(rel)) {
        onProgress?.({ event: "skip", rel, reason: "glob_filtered" });
        continue;
      }

      let lst: fs.Stats;
      try {
        lst = await fs.promises.lstat(abs);
      } catch {
        onProgress?.({ event: "skip", rel, reason: "lstat_failed" });
        continue;
      }

      if (lst.isSymbolicLink()) {
        if (!followSymlinks) {
          onProgress?.({ event: "skip", rel, reason: "symlink_forbidden" });
          continue;
        }

        let targetReal: string;
        try {
          targetReal = await realpathSafe(abs);
        } catch {
          onProgress?.({ event: "skip", rel, reason: "broken_symlink" });
          continue;
        }
        ensureUnderRoot(rootReal, targetReal);

        let rst: fs.Stats;
        try {
          rst = await fs.promises.stat(abs);
        } catch {
          onProgress?.({ event: "skip", rel, reason: "symlink_target_stat_failed" });
          continue;
        }

        if (rst.isDirectory()) {
          if (visitedDirReals.has(targetReal)) {
            onProgress?.({ event: "skip", rel, reason: "symlink_dir_cycle" });
            continue;
          }
          visitedDirReals.add(targetReal);
          q.push({ abs: targetReal, rel, depth: cur.depth + 1 });
          continue;
        }

        if (!rst.isFile()) {
          onProgress?.({ event: "skip", rel, reason: "symlink_target_not_file" });
          continue;
        }

        if (!matchesSuffix(ent.name, allowedSuffixes)) {
          onProgress?.({ event: "skip", rel, reason: "suffix_not_allowed" });
          continue;
        }

        const bytes = Number(rst.size);
        if (maxSingleFile && bytes > maxSingleFile) {
          throw new IngestError("single_file_too_large", {
            code: "SCAN_LIMIT",
            statusCode: 400,
          });
        }

        totalBytes += bytes;
        if (maxTotalBytes && totalBytes > maxTotalBytes) {
          throw new IngestError("total_bytes_exceeded", {
            code: "SCAN_LIMIT",
            statusCode: 400,
          });
        }

        out.push(Object.freeze({ path_rel: rel, abs_path: targetReal, bytes }));
        onProgress?.({
          event: "file",
          rel,
          files_seen: out.length,
          total_bytes_seen: totalBytes,
        });

        if (out.length > maxFiles) {
          throw new IngestError("max_files_exceeded", {
            code: "SCAN_LIMIT",
            statusCode: 400,
          });
        }

        continue;
      }

      if (lst.isDirectory()) {
        let dirReal: string;
        try {
         dirReal = await realpathSafe(abs);
        } catch {
          onProgress?.({ event: "skip", rel, reason: "dir_realpath_failed" });
          continue;
        }
        ensureUnderRoot(rootReal, dirReal);
        if (visitedDirReals.has(dirReal)) {
          onProgress?.({ event: "skip", rel, reason: "dir_cycle" });
          continue;
        }
        visitedDirReals.add(dirReal);
        q.push({ abs: dirReal, rel, depth: cur.depth + 1 });
        continue;
      }

      if (!lst.isFile()) {
        onProgress?.({ event: "skip", rel, reason: "not_regular_file" });
        continue;
      }

      if (!matchesSuffix(ent.name, allowedSuffixes)) {
        onProgress?.({ event: "skip", rel, reason: "suffix_not_allowed" });
        continue;
      }

      const bytes = Number(lst.size);
      if (maxSingleFile && bytes > maxSingleFile) {
        throw new IngestError("single_file_too_large", {
          code: "SCAN_LIMIT",
          statusCode: 400,
        });
      }

      totalBytes += bytes;
      if (maxTotalBytes && totalBytes > maxTotalBytes) {
        throw new IngestError("total_bytes_exceeded", {
          code: "SCAN_LIMIT",
          statusCode: 400,
        });
      }

      out.push(Object.freeze({ path_rel: rel, abs_path: abs, bytes }));
      onProgress?.({
        event: "file",
        rel,
        files_seen: out.length,
        total_bytes_seen: totalBytes,
      });

      if (out.length > maxFiles) {
        throw new IngestError("max_files_exceeded", {
          code: "SCAN_LIMIT",
          statusCode: 400,
        });
      }
    }
  }

  out.sort((a, b) => (a.path_rel < b.path_rel ? -1 : a.path_rel > b.path_rel ? 1 : 0));

  if (!out.length) {
    throw new IngestError("no_files_found", {
      code: "SCAN_EMPTY",
      statusCode: 400,
    });
  }

  return Object.freeze(out.slice());
}