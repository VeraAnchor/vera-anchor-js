// src/datasets/scan.ts
// Version: 1.0-hf-datasets-scan-v1 | 2026-03-05
// Purpose:
//   Local filesystem scan (adapter): deterministic file list with safety rules.
// Notes:
//   - Default: do not follow symlinks.
//   - Skip non-regular files.
//   - Deterministic ordering by normalized relative path.

import fs from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { DatasetError } from "./errors.js";
import {
  MAX_FILES_DEFAULT,
  MAX_TOTAL_BYTES_DEFAULT,
  MAX_SINGLE_FILE_BYTES_DEFAULT,
  MAX_ROOT_SCAN_DEPTH,
} from "./limits.js";
import type { DatasetRules, ScannedFile } from "./types.js";
import { normalizeRelPath } from "./pathNorm.js";

function asBool(v: unknown, def: boolean): boolean {
  return v === undefined ? def : Boolean(v);
}

function asInt(v: unknown, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function normSuffixes(v: unknown): ReadonlyArray<string> | null {
  if (!v) return null;
  if (!Array.isArray(v)) throw new DatasetError("allowed_suffixes_invalid", { code: "RULES_INVALID" });
  const out: string[] = [];
  for (const x of v) {
    const s = String(x ?? "").trim().toLowerCase();
    if (!s) continue;
    if (!s.startsWith(".")) throw new DatasetError("allowed_suffixes_must_start_dot", { code: "RULES_INVALID" });
    if (s.length > 32) throw new DatasetError("allowed_suffixes_too_long", { code: "RULES_INVALID" });
    out.push(s);
  }
  return out.length ? Object.freeze(out.slice()) : null;
}

function matchesSuffix(name: string, allowed: ReadonlyArray<string> | null): boolean {
  if (!allowed || !allowed.length) return true;
  const low = name.toLowerCase();
  for (const suf of allowed) if (low.endsWith(suf)) return true;
  return false;
}

function normGlobs(v: unknown, label: string): ReadonlyArray<string> | null {
  if (v == null) return null;
  if (!Array.isArray(v)) throw new DatasetError(`${label}_invalid`, { code: "RULES_INVALID" });
  const out: string[] = [];
  for (const x of v) {
    const s = String(x ?? "").trim();
    if (!s) continue;
    if (s.length > 2048) throw new DatasetError(`${label}_too_long`, { code: "RULES_INVALID" });
    out.push(s);
  }
  return out.length ? Object.freeze(out.slice()) : null;
}

function compileGlobFilter(includeGlobs: ReadonlyArray<string> | null, excludeGlobs: ReadonlyArray<string> | null) {
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
  } catch (e) {
    throw new DatasetError("realpath_failed", { code: "SCAN_FAILED", cause: e, statusCode: 500 });
  }
}

function ensureUnderRoot(rootReal: string, targetReal: string): void {
  const root = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  if (targetReal === rootReal) return;
  if (!targetReal.startsWith(root)) {
    throw new DatasetError("symlink_escapes_root", { code: "SYMLINK_ESCAPE", statusCode: 400 });
  }
}

 export type ScanProgress = Readonly<{
   event: "dir" | "file" | "skip";
   rel?: string;
   reason?: string;
   files_seen?: number;
   total_bytes_seen?: number;
 }>;

export async function scanDataset(rootDir: string, rules?: DatasetRules, onProgress?: (p: ScanProgress) => void): Promise<ReadonlyArray<ScannedFile>> {
  const root = path.resolve(String(rootDir ?? ""));
  if (!root) throw new DatasetError("root_dir_missing", { code: "ROOT_INVALID" });

  let st: fs.Stats;
  try {
    st = await fs.promises.lstat(root);
  } catch (e) {
    throw new DatasetError("root_dir_not_found", { code: "ROOT_INVALID", cause: e });
  }
  if (!st.isDirectory()) throw new DatasetError("root_dir_not_directory", { code: "ROOT_INVALID" });

  const rootReal = await realpathSafe(root);
  const followSymlinks = asBool(rules?.follow_symlinks, false);
  const maxFiles = Math.max(1, asInt(rules?.max_files, MAX_FILES_DEFAULT));
  const maxTotalBytes = Math.max(0, asInt(rules?.max_total_bytes, MAX_TOTAL_BYTES_DEFAULT));
  const maxSingleFile = Math.max(0, asInt(rules?.max_single_file_bytes, MAX_SINGLE_FILE_BYTES_DEFAULT));
  const allowedSuffixes = normSuffixes(rules?.allowed_suffixes);
  const includeGlobs = normGlobs((rules as any)?.include_globs, "include_globs");
  const excludeGlobs = normGlobs((rules as any)?.exclude_globs, "exclude_globs");
  const allowPath = compileGlobFilter(includeGlobs, excludeGlobs);

  // BFS walk with explicit depth control
  const out: ScannedFile[] = [];
  let totalBytes = 0;

  type QItem = { abs: string; rel: string; depth: number };
  const q: QItem[] = [{ abs: root, rel: "", depth: 0 }];

  while (q.length) {
    const cur = q.shift() as QItem;
    if (cur.depth > MAX_ROOT_SCAN_DEPTH) {
      throw new DatasetError("scan_depth_exceeded", { code: "SCAN_LIMIT" });
    }

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(cur.abs, { withFileTypes: true });
    } catch (e) {
      throw new DatasetError("scan_readdir_failed", { code: "SCAN_FAILED", cause: e, statusCode: 500 });
    }

    // Sort directory entries by name for determinism before normalization
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    onProgress?.({ event: "dir", rel: cur.rel || ".", files_seen: out.length, total_bytes_seen: totalBytes });

    for (const ent of entries) {
      const abs = path.join(cur.abs, ent.name);
      const relRaw = cur.rel ? `${cur.rel}/${ent.name}` : ent.name;
      const rel = normalizeRelPath(relRaw);

      if (!allowPath(rel)) {
        onProgress?.({ event: "skip", rel, reason: "glob_filtered" });
        continue;
      }

      const targetReal = await realpathSafe(abs);
      ensureUnderRoot(rootReal, targetReal);

      // Reject symlinks by default
      let lst: fs.Stats;
      try {
        lst = await fs.promises.lstat(abs);
      } catch (e) {
        onProgress?.({ event: "skip", rel, reason: "lstat_failed" });
        continue;
      }

      if (lst.isSymbolicLink()) {
        if (!followSymlinks) {
          onProgress?.({ event: "skip", rel, reason: "symlink_forbidden" });
          continue;
        }
        // If allowed, resolve and then stat target (but still refuse escapes is handled by path.rel check)
        let rst: fs.Stats;
        try {
          rst = await fs.promises.stat(abs);
        } catch (e) {
          onProgress?.({ event: "skip", rel, reason: "symlink_target_stat_failed" });
          continue;
        }
        if (rst.isDirectory()) {
          q.push({ abs, rel, depth: cur.depth + 1 });
          continue;
        }
        if (!rst.isFile()) {
          onProgress?.({ event: "skip", rel, reason: "symlink_target_not_file" });
          continue;
        }
        const bytes = Number(rst.size);
        if (maxSingleFile && bytes > maxSingleFile) throw new DatasetError("single_file_too_large", { code: "SCAN_LIMIT" });
        totalBytes += bytes;
        if (maxTotalBytes && totalBytes > maxTotalBytes) throw new DatasetError("total_bytes_exceeded", { code: "SCAN_LIMIT" });
        if (!matchesSuffix(ent.name, allowedSuffixes)) {
          onProgress?.({ event: "skip", rel, reason: "suffix_not_allowed" });
          continue;
        }
        out.push(Object.freeze({ path_rel: rel, abs_path: abs, bytes }));
        onProgress?.({ event: "file", rel, files_seen: out.length, total_bytes_seen: totalBytes });
        if (out.length > maxFiles) throw new DatasetError("max_files_exceeded", { code: "SCAN_LIMIT" });
        continue;
      }

      if (lst.isDirectory()) {
        q.push({ abs, rel, depth: cur.depth + 1 });
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
      if (maxSingleFile && bytes > maxSingleFile) throw new DatasetError("single_file_too_large", { code: "SCAN_LIMIT" });
      totalBytes += bytes;
      if (maxTotalBytes && totalBytes > maxTotalBytes) throw new DatasetError("total_bytes_exceeded", { code: "SCAN_LIMIT" });

      out.push(Object.freeze({ path_rel: rel, abs_path: abs, bytes }));
      onProgress?.({ event: "file", rel, files_seen: out.length, total_bytes_seen: totalBytes });

      if (out.length > maxFiles) throw new DatasetError("max_files_exceeded", { code: "SCAN_LIMIT" });
    }
  }

  // Deterministic ordering
  out.sort((a, b) => (a.path_rel < b.path_rel ? -1 : a.path_rel > b.path_rel ? 1 : 0));

  if (!out.length) throw new DatasetError("no_files_found", { code: "SCAN_EMPTY" });

  return Object.freeze(out.slice());
}